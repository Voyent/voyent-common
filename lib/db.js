var config      = require('./config');
var MongoClient = require('mongodb').MongoClient;
var util        = require('util');
var us          = require('underscore');
var errors      = require('./errors');
var ld          = require('lodash');
var mongodbUri  = require('mongodb-uri');

//The dbURLPrefix is used to connect to the database. The name of the
//database (account) is appended to the end of the prefix.  These default
//values are suitable for our simple Docker environments - like running
//locally or in basic cloud environments where the database service is
//just referenced as "db". Also, for these environments, there are no dbOptions
//that we need to set/override.  When connecting to a hosted MongoDB service
//like MongoDB Atlas, the DB_URI environment variable is set and processed
//by the determineDBConnectionSettings() function below.
var dbURLPrefix = config.database.scheme + '://' +
    config.database.host + ':' +
    config.database.port + '/';

var dbOptions = {};

/**
 * For local development or running on a basic Cloud environment, the
 * dbURLPrefix and dbOptions are pretty simple.  When running in a more
 * sophisticated environment (e.g. connected to MongoDB Atlas), things are
 * a bit more complex.  This function attempts to set things up appropriately
 * for any environment. In general, the basic settings are overridden if an
 * environment variable called DB_URI is set.  If that is the case, we take
 * the incoming value as a valid MongoDB connection string and process it so
 * that it can be used by our internal code for accessing databases, etc.
 */
function determineDBConnectionSettings() {

    //The prefix can change depending on the environment we are running in.
    //The default of mongodb://db:27017/ is fine for local Docker and simple
    //Docker Cloud environments. However, if DB_URI is set, it means we're
    //running on AWS and pointing to a cloud-based version of Mongo Atlas.
    if (process.env.DB_URI) {

        console.log('DB_URI', process.env.DB_URI);

        //A MongoDB URI is special in that it can have multiple hosts separated
        //by commmas.  This is for replicate sets.   However, the URL cannot be
        //parsed by a normal URL parser so we use one that MongoLab has made
        //available.
        var parsedDBURI = mongodbUri.parse(process.env.DB_URI);
        // console.log('parsed DB_URI', JSON.stringify(parsedDBURI, null, 4));

        //The result is an object filled with goodness. But there is still some
        //work to do putting the host:port, host:port string back together...
        var hosts = ld.map(parsedDBURI.hosts, function (item) {
            return item.host + ':' + item.port;
        });

        //Generate a prefix we can use going forward.
        dbURLPrefix = parsedDBURI.scheme + '://' +
            parsedDBURI.username + ':' +
            parsedDBURI.password + '@' +
            hosts.join() + '/';

        //The parser will have converted the query params to an options object
        //for us.  However, all the values will be Strings and it turns out
        //that connection won't work if ssl="true".  It must be ssl=true.  So
        //here we convert any strings that look like booleans to actual
        //booleans as well as numbers to actual numbers.
        dbOptions = ld.mapValues(parsedDBURI.options, function (val) {

            if (val === 'true') {
                return true;
            }

            if (val === 'false') {
                return false;
            }

            //If it's possible to convert it to an integer, we need to do that.
            var valAsInt = parseInt(val);
            if(isNaN(valAsInt) === false){
                return valAsInt;
            }

            return val;
        });

    }

    console.log('dbURLPrefix', JSON.stringify(dbURLPrefix, null, 4));
    console.log('dbOptions', JSON.stringify(dbOptions, null, 4));

}

determineDBConnectionSettings();


//An object used to cache the database information for realms and accounts. It should look something like:
var dbClients = {};
//var dbClientSample = {
//    "realmNameOrAccountName": {
//        "touched": 1409243420271,
//        "database": "theDatabaseConnectionReference",
//        "accountName": "linkFromRealmToAccount"
//    }
//}

//An interval function that sweeps through the list of dbClients and removes any inactive ones.
var cacheCleaner;

//If using the shared connection approach where all databases use a single pool, then you need
//to have an intiial database reference.
var initialDB;

//The database collection that holds the realm and account information.  This should only be kept
//around until we have a valid service call although it may be valid for testing purposes.
var accountsCollection;

//Determine which connection strategy to use and set the appropriate function.
var getClientStrategy = config.database.sharedConnections ? getClientShared : getClient;


var delayedProcessingTimeout = 20;

// Map of accountName keyed booleans indicating a connection attempt is in progress.
var currentlyProcessing = { };

//Debugging counters
var stats = {
    strategy: (config.database.sharedConnections ? 'shared' : 'not shared'),
    collectionRequests: 0,
    cacheHits: 0,
    cacheDelays: 0,
    dbClientCreated: 0,
    dbClientDestroyed: 0,
    collectionCreated: 0,
    collectionFound: 0
};

/**
 * Perform a native mongo check to see if a given database and realm exists.
 * takes callback with pattern function(boolean) that returns true if collection found, false if
 * either database or collection is not found. Collection names are lowercased as per the model creation
 * code
 * @param accountName the account name, will be treated for safeness
 * @param collectionName The collection name, but must be in the final form, eg. 'realmname.users'
 *        'realmname.mytestbucket.docs', 'realmname.actions'
 */
function testCollectionExistence(accountName, collectionName, cb) {

    var logger = require('./loggers').getLogger();
    var safeDB = getSafeDatabaseName(accountName);

    getClient('test', function(err, testDb) {
        if (err) {
            logger.error('exception getting test.admin(): ' + JSON.stringify(err));
            return cb(false);
        }

        if(!testDb){
            logger.error('no "test" database found for admin operations');
            return cb(false);
        }
        // Use the admin database for the operation
        var adminDb = testDb.admin();

        // List all the available databases
        adminDb.listDatabases(function(err, dbs) {
            if (err) {
                logger.error('Exception getting list of databases: ' + JSON.stringify(err));
                return cb(false);
            }
            var found = false;
            for (var i = 0; i < dbs.databases.length; i++) {
                if (dbs.databases[i].name === safeDB) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                logger.debug('No existing database found: ' + safeDB);
                return cb(false);
            }
            getClient(safeDB, function(err, db) {
                if (err) {
                    logger.error('Exception getting database connection: ' + JSON.stringify(err));
                    return cb(false);
                }
                db.listCollections( {} ).toArray(function(err, items) {
                    if (err) {
                        logger.error('Exception getting list of collections: ' + JSON.stringify(err));
                        return cb(false);
                    }
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].name === collectionName.toLowerCase()) {
                            return cb(true);
                        }
                    }
                    logger.debug('DB ' + safeDB + ' has no matching collection: ' +
                        collectionName + ' in: ' + JSON.stringify(items));

                    return cb(false);
                });
            });
        });
    });
}
module.exports.testCollectionExistence = testCollectionExistence;

/**
 * Perform a native mongo check to see if a given database exists.
 * takes callback with pattern function(boolean) that returns true if the database was found, false otherwise
 */
function testDatabaseExistence(accountName, cb) {

    var logger = require('./loggers').getLogger();
    var safeDB = getSafeDatabaseName(accountName);

    getDatabaseList(function (err, dbs) {
        for (var i = 0; i < dbs.length; i++) {
            if (dbs[i].name == safeDB) {
                return cb(true);
            }
        }
        if (dbs.length == 0) {
            logger.debug('Existing db list is EMPTY?');
        }

        if (!safeDB) {
            var err = new Error();
            logger.warn('Check database is empty: ' + err.stack);
        } else {
            logger.debug('DBCheck: No Exiting database found: [' + safeDB + ']');
        }
        return cb(false);
    });
}
module.exports.testDatabaseExistence = testDatabaseExistence;

/**
 * Perform a native mongo check to see if a given database exists.
 * takes callback with pattern function(boolean) that returns true if the database was found, false otherwise
 */
function getDatabaseList(cb) {

    var logger = require('./loggers').getLogger();

    getClient('test', function(err, testDb) {
        // Use the admin database for the operation
        var adminDb = testDb.admin();

        // List all the available databases
        adminDb.listDatabases(function(err, dbs) {
            if (err) {
                logger.error('Exception getting list of databases: ' + JSON.stringify(err));
                return cb(null, []);
            }
            logger.debug('Database list size: ' + dbs.databases.length ); // + ', Entries: ', JSON.stringify(dbs));
            return cb(null, dbs.databases);
        });
    });
}
module.exports.getDatabaseList = getDatabaseList;

/**
 * Get an account record from the 'safeaccountname'.admin.accounts collection. This function
 * - Does not create any collections or databases if they do not already exist (unlike the mongoose version)
 * - fails if any of the necessary contents are missing (eg. collection must contain a valid account record)
 *
 * This should be called only sparingly since it should be very slow. Auth has a version of this
 *
 * @param accountName The accountName may be the 'client' or the safe database name
 * @param cb a callback of the form (err, accountRecord)
 */
var getAccountRecord = function (accountName, cb) {

    var logger = require('./loggers').getLogger();
    var safeName = getSafeDatabaseName(accountName);
    testCollectionExistence(safeName, 'admin.accounts', function(doesExist) {

        if (!doesExist) {
            logger.error('Native DB account check finds no admin.accounts collection exists: [' + accountName + ']');
            return cb(new errors.ServerError('accountNotFound'), null);
        }
        getCollection(safeName, 'admin', 'accounts', function(err, collection) {

            collection.findOne({}, function (err, account) {
                if (err) {
                    logger.error('Exception finding account record in admin.accounts collection', err);
                    return cb(err, null);
                }
                if (!account.accountname) {
                    logger.error('Invalid account record, missing accountname');
                    return cb(new errors.ServerError('accountNotFound'), null);
                }
                return cb(null, account);
            });
        });
    });
};
module.exports.getAccountRecord = getAccountRecord;


/**
 * Perform a native mongo call to get all the collections from a given account
 *
 */
function getCollections(safeAccountName, cb) {

    var logger = require('./loggers').getLogger();

    getClient(safeAccountName, function(err, db) {
        if (err) {
            logger.error('Exception getting database connection: ' + JSON.stringify(err));
            return cb(false);
        }
        db.listCollections( {} ).toArray(function(err, items) {
            if (err) {
                logger.error('Exception getting list of collections: ' + JSON.stringify(err));
                return cb(false);
            }
            return cb(false, items);
        });
    });
}
module.exports.getCollections = getCollections;


/**
 * Get all the collections in a given database that match our convention of
 * starting with a realm name
 *
 * @param accountName
 * @param realmName
 */
function getRealmCollections(accountName, realmName, callback) {
    var safeDB = getSafeDatabaseName(accountName);
    var logger = require('./loggers').getLogger();

    getCollections(safeDB, function (err, items) {
        if (err) {
            logger.error('Exception getting database connection: ' + JSON.stringify(err));
            return callback(err, []);
        }
        var collList = [];
        for (var i = 0; i < items.length; i++) {
            var spos = items[i].name.toLowerCase().indexOf(realmName.toLowerCase());
            if (spos === 0) {
                logger.debug('Found matching realm: ' + items[i].name + ' === ' + realmName);
                collList.push(items[i].name);
            }
        }
        return callback(err, collList);
    });
}
module.exports.getRealmCollections = getRealmCollections;


/**
 * Go through all found collections associated with 'realm'
 * and drop them. This function should only be called from a situation where
 * it is known that the database exists (eg. dropRealm code in authadmin)
 * cb function (err)
 */
function dropAllRealmCollections(accountName, realmName, cb) {

    var logger = require('./loggers').getLogger();
    var safeDB = getSafeDatabaseName(accountName);

    getClient(safeDB, function(err, db) {
        if (err) {
            logger.error('Exception getting database connection: ' + JSON.stringify(err));
            return cb(err);
        }
        getRealmCollections(accountName, realmName, function (err, items) {
            if (err) {
                return cb(err);
            }

            if (items.length == 0) {
                return cb(null);
            }
            var dropCount = 0;
            for (var i = 0; i < items.length; i ++) {
                logger.debug('-Dropping collection: ' + items[i]);
                dropCollection(db, items[i], function(err, result) {
                    if (err) {
                        logger.error('Exception dropping collection: ' + JSON.stringify(err));
                        return cb(err);
                    }
                    if (++dropCount === items.length) {
                        return cb(null);
                    }
                })
            }
        });
    });
}
module.exports.dropAllRealmCollections = dropAllRealmCollections;


/**
 * Perform a native mongo database removal. callback of form function(err)
 * There is a mongoose version of this
 */
function dropDatabase(accountName,  cb) {

    getClient(accountName, function(err, db) {
        if (err) {
            return cb(err, false);
        }
        db.dropDatabase(function (err, result) {
            cb(err, result);
        });
    });
}
module.exports.dropDatabase = dropDatabase;


/**
 * Perform a native mongo database collection removal. callback of form function(err)
 */
function dropCollection(accountDB, collectionName, cb) {

    accountDB.dropCollection(collectionName, function (err, result) {
        // Handle known case error (which is no error)
        if (err && (err.errmsg.indexOf('ns not found') > -1)) {
            return cb(null, result);
        }
        return cb(err, result);
    });
}
module.exports.dropCollection = dropCollection;


//The callback returns a MongoDB client connection to the database associated with the account.  This
//approach creates a new client per database and opens a connection pool for each (default 5).  So:
//   total connections used = active databases * 5
//This creates a greater number of connections than the shared strategy below - which creates a single
//pool and shares them with all databases.  Because of this, this function also kicks off an interval
//cache cleaning function to close client connections that haven't been used for a configurable duration.
function getClient(accountName, cb) {

    var logger = require('./loggers').getLogger();

    //Start a cleaner for db connections that haven't been used in awhile
    if (!cacheCleaner) {
        cacheCleaner = setInterval(cleanDBClientCache, config.database.clientExpiry);
    }

    if (currentlyProcessing[accountName]) {

        stats.cacheDelays ++;
        setTimeout(getClient.bind(this, accountName, cb), delayedProcessingTimeout);

    } else {

        currentlyProcessing[accountName] = true;

        //If there is a cached dbClient using the account name,
        //update the time it was requested and return it.
        var dbClient = dbClients[accountName];
        if (dbClient) {
            dbClient.touched = Date.now();
            //logger.debug('db client retrieved from cache');
            stats.cacheHits += 1;
            currentlyProcessing[accountName] = false;
            return cb(null, dbClient.database);
        }

        //Looks like we don't currently have a database connection so make a new one.
        var dbURL = dbURLPrefix + accountName;
        //logger.debug('connecting to ' + dbURL);

        //Make the actual connection.  We may want to check with Auth service as to
        //whether this is a real account and only create it it should be created.
        MongoClient.connect(dbURL, dbOptions, function (err, db) {

            if (err) {
                logger.error('problem connecting to MongoDB @ ' + dbURL, err);
                currentlyProcessing[accountName] = false;
                return cb(err, null);
            }

            //Cache the new connection and return it.  We cache it under both the realm
            //name and the account name as all realms will use the same connection pool.
            dbClients[accountName] = {
                touched: Date.now(),
                database: db
            };
            //logger.debug('new db client added to cache: ' + accountName);
            stats.dbClientCreated += 1;
            currentlyProcessing[accountName] = false;
            return cb(null, db);
        });
    }
}
module.exports.getClient = getClient;


//As per the rules for MongoDB database naming:
//
//   http://docs.mongodb.org/manual/reference/limits/#naming-restrictions
//
//This function:
//  - converts spaces to underscores
//  - removes any other illegal characters
//  - ensures the string length is less than 64 characters
//  - converts everything to lowercase
function getSafeDatabaseName(accountName) {
    return accountName.split(' ').join('_').replace(/[\\\/\.\"]/g, '').substring(0, 63).toLowerCase();
}
module.exports.getSafeDatabaseName = getSafeDatabaseName;


function dumpStats() {
    //var logger = require('./loggers').getLogger();
    console.log(JSON.stringify(stats, null, 4));
}
module.exports.dumpStats = dumpStats;


function cleanDBClientCache() {

    //var logger = require('./loggers').getLogger();

    us.each(dbClients, function (dbClient, dbClientKey, dbClients) {

        var touched = dbClient.touched;

        //See if the database connection hasn't been used over the configured expiry duration.
        var timeLeft = (touched + config.database.clientExpiry) - Date.now();
        //logger.debug('[' + dbClientKey + ']  expired: ' + (timeLeft < 0) + '  left: ' + timeLeft);

        if (timeLeft <= 0) {
            //Need to remove the client from the cache and close the connection.
            dbClient.database.close();
            delete dbClients[dbClientKey];
//            dbClients[dbClientKey] = null;

            stats.dbClientDestroyed += 1;
        }
    });
    //dumpStats();
}


function getClientShared(accountName, cb) {

    //var logger = require('./loggers').getLogger();

    //If we have not yet established a single database connection, then do it now.
    if (!initialDB) {

        var dbURL = dbURLPrefix + accountName;
        //logger.debug('connecting to initial database ' + dbURL);

        //Make the actual connection.  We may want to check with Auth service as to
        //whether this is a real account and only create it it should be created.
        MongoClient.connect(dbURL, dbOptions, function (err, db) {

            if (err) {
                //logger.error('problem connecting to MongoDB @ ' + dbURL, err);
                return cb(err, null);
            }

            //Save the initial db reference
            initialDB = db;
            //logger.debug('initial database set');

            //Cache the initial connection and return the db.
            dbClients[accountName] = {
                touched: Date.now(),
                database: db
            };

            //logger.debug('initial db client added to cache');
            stats.dbClientCreated += 1;

            return cb(null, db);
        });


    } else {

        //If there is a cached db client for the account, update the time it was requested and return it.
        var dbClient = dbClients[accountName];
        if (dbClient) {
            dbClient.touched = Date.now();

            //logger.debug('realm client retrieved from cache ' + accountName);
            stats.cacheHits += 1;

            return cb(null, dbClient.database);
        }

        //logger.debug('[' + accountName + '] not cached in ' + JSON.stringify(us.keys(dbClients), null, 4));

        //If there is nothing cached, create a new one using the initial one.
        var dbWithSharedConnections = initialDB.db(accountName);

        //Cache the newly created client
        dbClients[accountName] = {
            touched: Date.now(),
            database: dbWithSharedConnections
        };

        //logger.debug('shared db client added to cache');
        stats.dbClientCreated += 1;

        return cb(null, dbWithSharedConnections);
    }
}
module.exports.getClientShared = getClientShared;

/**
 * get a collection mapped from a given account + realm + collectionName
 * @param accountName
 * @param realmName
 * @param collectionName
 * @param cb
 * @returns {*}
 */
function getCollection(accountName, realmName, collectionName, cb) {

    var logger = require('./loggers').getLogger();
    stats.collectionRequests += 1;

    return getClientStrategy(accountName, function (dbErr, db) {

        if (dbErr) {
            logger.error('problem getting client', dbErr);
            return cb(dbErr, null);
        }

        var fullCollectionName = realmName + '.' + collectionName;
        //logger.debug('getting client for: ' + accountName + ' -> ' + fullCollectionName);

        db.collection(fullCollectionName, {strict: false}, function (collErr, coll) {

            if (collErr) {
                logger.error('problem getting reference to collection', collErr);
                return cb(collErr, null);
            }

            if (coll) {
                //logger.debug('found existing collection', coll.collectionName);
                stats.collectionFound += 1;
                return cb(null, coll);
            }

            //We've can set 'strict' so collections are not automatically created when asked for
            //but we should add some logic here to ensure that the collection we are planning
            //to create manually is legal and authorized.  This might require an call to the
            //Auth service or maybe just a direct database call into the Account information.

            //Also, we should consider setting any provided index(es) when the collection is
            //created.
            db.createCollection(fullCollectionName, {w: 1}, function (createErr, newCollection) {
                if (createErr) {
                    logger.error('could not create collection', createErr);
                    return cb(createErr, null);
                }
                //logger.debug('created new collection', newCollection.collectionName);
                stats.collectionCreated += 1;
                return cb(null, newCollection);
            });

        });
    });
}
module.exports.getCollection = getCollection;

/**
 * get a collection mapped from a given account + realm + collectionName
 * @deprecated Should use the index mechanism provided in
 * @param accountName
 * @param realmName
 * @param collectionName
 * @param capsize The number of records in a capped collection
 * @param cb
 * @returns {*}
 */
function getCappedCollection(accountName, realmName, collectionName, capsize, cb) {

    var logger = require('./loggers').getLogger();
    stats.collectionRequests += 1;
    var capSize = capsize || 100000;

    return getClientStrategy(accountName, function (dbErr, db) {

        if (dbErr) {
            logger.error('problem getting client', dbErr);
            return cb(dbErr, null);
        }

        var fullCollectionName = realmName + '.' + collectionName;
        //logger.debug('getting client for: ' + accountName + ' -> ' + fullCollectionName);

        db.collection(fullCollectionName, {strict: false}, function (collErr, coll) {

            if (collErr) {
                logger.error('problem getting reference to collection', collErr);
                return cb(collErr, null);
            }

            if (coll) {
                //logger.debug('found existing collection', coll.collectionName);
                stats.collectionFound += 1;
                return cb(null, coll);
            }
            // Apparently we can only cap a collection when creating one
            // or when there are no records.
            var options = {
                w:1,
                capped: true,
                count: capsize
            };
            db.createCollection(fullCollectionName, options, function (createErr, newCollection) {
                if (createErr) {
                    logger.error('could not create collection', createErr);
                    return cb(createErr, null);
                }
                //logger.debug('created new collection', newCollection.collectionName);
                stats.collectionCreated += 1;
                return cb(null, newCollection);
            });

        });
    });
}
module.exports.getCappedCollection = getCappedCollection;



/**
 * Get a plain connection to an account database using the currently configured strategy
 */
function getConnectionCurrentStrategy(accountName, callback) {
     getClientStrategy(accountName, callback);
}
module.exports.getConnectionCurrentStrategy = getConnectionCurrentStrategy;


//This should probably only be used for the purposes of testing as you may
//not want to cut connections drastically during production service shutdown.
function shutdown() {

    //var logger = require('./loggers').getLogger();
    //logger.debug('shutting down database clients...');

    us.each(dbClients, function (dbClient, cacheKey, dbClients) {
        //logger.debug('[' + cacheKey + ']  closing');
        dbClient.database.close();
        delete dbClients[cacheKey];
    });

    if (cacheCleaner) {
        clearInterval(cacheCleaner);
    }

}
module.exports.shutdown = shutdown;
