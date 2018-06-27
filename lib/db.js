const config = require('./config');
const MongoClient = require('mongodb').MongoClient;
const errors = require('./errors');
const ld = require('lodash');
const mongodbUri = require('mongodb-uri');
const async = require('async');

//The dbConnectionURL is used to connect to the database. The default
//values are suitable for our simple Docker environments - like running
//locally or in basic cloud environments.  Additionally, for these environments
//there are no dbOptions that we need to set/override.  When connecting to a
//hosted MongoDB service like MongoDB Atlas, the DB_URI environment variable is
//set and processed by the determineDBConnectionSettings() function below.
let dbConnectionURL = config.database.scheme + '://' +
    config.database.host + ':' +
    config.database.port + '/';

let dbOptions = {};

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
        let parsedDBURI = mongodbUri.parse(process.env.DB_URI);
        // console.log('parsed DB_URI', JSON.stringify(parsedDBURI, null, 4));

        //The result is an object filled with goodness. But there is still some
        //work to do putting the host:port, host:port string back together...
        let hosts = ld.map(parsedDBURI.hosts, function (item) {
            return item.host + ':' + item.port;
        });

        //Generate a prefix we can use going forward.
        dbConnectionURL = parsedDBURI.scheme + '://' +
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
            let valAsInt = parseInt(val);
            if (isNaN(valAsInt) === false) {
                return valAsInt;
            }

            return val;
        });

    }

    console.log('dbURLPrefix', JSON.stringify(dbConnectionURL, null, 4));
    console.log('dbOptions', JSON.stringify(dbOptions, null, 4));

}

determineDBConnectionSettings();


/**
 * Call that returns a database reference associated with the provided account
 * name.  The logic has been dramatically simplified to rely on the driver's
 * own connection caching logic rather than our original approach that tried
 * to keep things more "sandboxed" (pre-VRAS).
 *
 * For backwards compatibility, this call returns a database instance rather
 * than the actual MongoClient instance.  Eventually, when we move to the 3.x
 * version of the driver, getting a MongoClient and getting a database reference
 * can be separate concerns.  For now, I've changed the name of the function to
 * match what it is doing but it still gets exported as getClient() so that
 * all the services that are currently using it don't melt down.
 *
 * It also can be used a replacement for the getConnectionCurrentStrategy()
 * call which is no longer required.
 *
 * @param accountName
 * @param cb
 * @returns {*}
 */
function getDatabase(accountName, cb) {

    const logger = require('./loggers').getLogger();

    const dbURL = dbConnectionURL + getSafeDatabaseName(accountName);

    MongoClient.connect(dbURL, dbOptions, function (err, db) {

        if (err) {
            logger.error('problem getting database', dbURL, err);
            cb(err);
            return;
        }

        cb(null, db);
    });
}

//Export this call as getClient and getConnectionCurrentStrategy for backwards
//compatibility.
module.exports.getClient = getDatabase;
module.exports.getConnectionCurrentStrategy = getDatabase;
module.exports.getDatabase = getDatabase;


/**
 * Only returns a database reference if it already has collections in it.
 * Otherwise it returns nothing.
 *
 * @param accountName
 * @param cb
 */
function getDatabaseStrict(accountName, cb) {

    getDatabase(accountName, function (err, db) {

        if (err) {
            cb(err);
            return;
        }

        db.listCollections({}).toArray(function (err, colls) {

            if (err) {
                cb(err);
                return;
            }

            //If this database has no existing collections, we assume it's new
            //and was automatically "created" by MongoDB.  Because we are being
            //strict, we close the connection and return nothing.
            if (!colls || colls.length === 0) {
                db.close();
                cb();
                return;
            }

            cb(null, db);

        });

    });

}

module.exports.getDatabaseStrict = getDatabaseStrict;


/**
 * Check to see if a given database and realm exists. Takes callback with
 * pattern function(boolean) that returns true if collection found, false if
 * either database or collection is not found. Collection names are lowercased
 * as per the model creation code.
 *
 * @param accountName the account name, will be treated for safeness
 * @param collectionName The collection name, but must be in the final form:
 *
 *            realmname.users
 *            realmname.mytestbucket.docs
 *            realmname.actions
 *
 * @param cb
 */
function collectionExists(accountName, collectionName, cb) {

    getDatabaseStrict(accountName, function (err, db) {

        if (err || !db) {
            cb(false);
            return;
        }

        db.collection(collectionName, {strict: true}, function (err, coll) {

            if (err || !coll) {
                cb(false);
                return;
            }

            cb(true);
        });

    });
}

module.exports.collectionExists = collectionExists;
module.exports.testCollectionExistence = collectionExists;


/**
 * Perform a native mongo check to see if a given database exists. Takes
 * callback with pattern function(boolean) that returns true if the database was
 * found, false otherwise.
 *
 * @param accountName
 * @param cb
 */
function databaseExists(accountName, cb) {

    getDatabaseStrict(accountName, function (err, db) {

        if (err || !db) {
            cb(false);
            return;
        }

        cb(true);
        // db.close();
    });
}

module.exports.databaseExists = databaseExists;
module.exports.testDatabaseExistence = databaseExists;


/**
 *
 * USE WITH CAUTION!
 *
 * Performs a native mongo check to see if a given database exists. Takes
 * callback with pattern function(boolean) that returns true if the database was
 * found, false otherwise.
 *
 * This function uses the listDatabases function which is very expensive in
 * versions of MongoDB before 3.6 because it locks each database to do a size
 * calculation.  With 3.6, you can provide a "nameOnly" parameter to avoid the
 * locking but we're not there yet.
 *
 * This should not be used in code paths that are called frequently and
 * require optimum performance.
 *
 * @param cb
 */
function getDatabaseList(cb) {

    const logger = require('./loggers').getLogger();

    getDatabase('test', function (err, testDb) {

        // Use the admin database for the operation
        let adminDb = testDb.admin();

        // List all the available databases
        adminDb.listDatabases(function (err, dbs) {

            if (err) {
                logger.error('Exception getting list of databases: ' + JSON.stringify(err));
                return cb(null, []);
            }

            // logger.debug('Database list size: ' + dbs.databases.length );
            // logger.debug('Entries: ', JSON.stringify(dbs) );

            return cb(null, dbs.databases);
        });
    });
}

module.exports.getDatabaseList = getDatabaseList;

/**
 * Get an account record from the 'safeaccountname'.admin.accounts collection.
 * This function:
 *
 * - Does not create any collections or databases if they do not already exist
 *   (unlike the mongoose version)
 * - fails if any of the necessary contents are missing (eg. collection must
 *   contain a valid account record)
 *
 * @param accountName The accountName may be the 'client' or the safe database name
 * @param cb a callback of the form (err, accountRecord)
 */
function getAccountRecord(accountName, cb) {

    const logger = require('./loggers').getLogger();

    getDatabaseStrict(accountName, function (err, db) {

        if (err || !db) {
            cb(new errors.ServerError('accountNotFound'));
            return;
        }

        db.collection('admin.accounts', {strict: true}, function (err, coll) {

            if (err || !coll) {
                cb(new errors.ServerError('accountNotFound'));
                return;
            }

            coll.findOne({}, function (err, account) {

                if (err) {
                    logger.error('exception finding account record', accountName, err);
                    cb(err);
                    return;
                }

                if (!account) {
                    logger.error('no account record found', accountName);
                    cb(new errors.ServerError('accountNotFound'));
                    return;
                }

                if (!account.accountname) {
                    logger.error('invalid account record, missing accountname', accountName);
                    cb(new errors.ServerError('accountNotFound'));
                    return;
                }

                return cb(null, account);
            });

        });

    });

}

module.exports.getAccountRecord = getAccountRecord;


/**
 * Perform a native mongo call to get all the collections from a given account
 *
 */
function getCollections(safeAccountName, cb) {

    //TODO: not sure if this is actually used externally.  Is used internally.

    const logger = require('./loggers').getLogger();

    getDatabase(safeAccountName, function (err, db) {
        if (err) {
            logger.error('Exception getting database connection: ' + JSON.stringify(err));
            return cb(false);
        }
        db.listCollections({}).toArray(function (err, items) {
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
 * Get the names of all the collections in a an account that are prefixed with
 * the realm/region name.
 *
 * @param accountName
 * @param realmName
 * @param cb
 */
function getRealmCollectionNames(accountName, realmName, cb) {

    const logger = require('./loggers').getLogger();

    getDatabaseStrict(accountName, function (err, db) {

        if (err) {
            logger.error('problem connecting to database', accountName, err);
            cb(err);
            return;
        }

        if (!db) {
            logger.error('cannot find database', accountName, err);
            cb(new errors.ServerError('accountNotFound'));
            return;
        }

        logger.debug('get collection names for', realmName);

        const startsWithRealm = new RegExp('^' + realmName + '\.', 'i');
        db.listCollections({name: {$regex: startsWithRealm}}).toArray(function (err, collInfo) {

            if (err) {
                logger.error('problem getting list of collections', accountName, realmName, err);
                cb(err);
                return;
            }

            let collNames = ld.map(collInfo, 'name');
            // logger.debug(JSON.stringify(collNames, null, 4));

            cb(null, collNames);
        });
    });
}

module.exports.getRealmCollections = getRealmCollectionNames;
module.exports.getRealmCollectionNames = getRealmCollectionNames;


/**
 * Find all the collections in an account that are prefixed with the realm/region
 * name and drop them.
 *
 * @param accountName
 * @param realmName
 * @param cb
 */
function dropRealmCollections(accountName, realmName, cb) {

    const logger = require('./loggers').getLogger();

    getDatabaseStrict(accountName, function (err, db) {

        if (err) {
            logger.error('problem connecting to database', accountName, err);
            cb(err);
            return;
        }

        if (!db) {
            logger.error('cannot find database', accountName, err);
            cb(new errors.ServerError('accountNotFound'));
            return;
        }

        db.collections(function (err, colls) {

            if (err) {
                logger.error('problem getting collections', accountName, realmName, err);
                cb(err);
                return;
            }

            const startsWithRealm = new RegExp('^' + realmName + '\.', 'i');

            async.eachLimit(colls, 3,
                function (coll, acb) {

                    if (startsWithRealm.test(coll.collectionName)) {

                        logger.debug('dropping', coll.namespace);

                        coll.drop(function (err) {
                            if (err) {
                                logger.warn('could not drop', coll.namespace);
                            }
                            acb();
                        });

                    } else {
                        acb();
                    }

                }, function (err) {

                    if (err) {
                        cb(err);
                        return;
                    }

                    logger.debug('dropped all realm collections for', accountName, realmName);
                    cb();
                });
        });
    });
}

module.exports.dropAllRealmCollections = dropRealmCollections;
module.exports.dropRealmCollections = dropRealmCollections;


/**
 * Drop the database for the specified account, if it exists.
 */
function dropDatabase(accountName, cb) {

    getDatabaseStrict(accountName, function (err, db) {
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

    //TODO: used by Auth Service in one place

    accountDB.dropCollection(collectionName, function (err, result) {
        // Handle known case error (which is no error)
        if (err && (err.errmsg.indexOf('ns not found') > -1)) {
            return cb(null, result);
        }
        return cb(err, result);
    });
}

module.exports.dropCollection = dropCollection;


/**
 * Given an account name, returns a safe version that can be used for MongoDB
 * database name as per the rules found here:
 *
 *    http: * docs.mongodb.org/manual/reference/limits/#naming-restrictions
 *
 * The main steps are:
 *
 *   - converts spaces to underscores
 *   - removes any other illegal characters
 *   - ensures the string length is less than 64 characters
 *   - converts everything to lowercase
 *
 * @param accountName
 * @returns {string}
 */
function getSafeDatabaseName(accountName) {
    return accountName.split(' ')
        .join('_')
        .replace(/[\\\/."]/g, '')
        .substring(0, 63)
        .toLowerCase();
}

module.exports.getSafeDatabaseName = getSafeDatabaseName;


function dumpStats() {
    const logger = require('./loggers').getLogger();
    logger.warn('db.dumpStats is no longer supported');
}

module.exports.dumpStats = dumpStats;


/**
 * Newer Function that allows client to specify the 'strict' flag on collection creation
 *
 * @param accountName  The safe account name
 * @param realmName    The realm name
 * @param collectionName The collection name within the realm
 * @param options
 * @param cb            callback of form (err, collection)
 */
function getCollectionWithOptions(accountName, realmName, collectionName, options, cb) {

    //TODO: used by Auth Service in one place

    const logger = require('./loggers').getLogger();

    return getDatabase(accountName, function (dbErr, db) {

        if (dbErr) {
            logger.error('problem getting client', dbErr);
            return cb(dbErr, null);
        }

        let fullCollectionName = realmName + '.' + collectionName;
        //logger.debug('getting client for: ' + accountName + ' -> ' + fullCollectionName);

        db.collection(fullCollectionName, options, function (collErr, coll) {

            if (collErr) {
                logger.error('problem getting reference to collection', collErr);
                return cb(collErr, null);
            }

            if (coll) {
                //logger.debug('found existing collection', coll.collectionName);
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
                return cb(null, newCollection);
            });
        });
    });
}

module.exports.getCollectionWithOptions = getCollectionWithOptions;

/**
 * get a collection mapped from a given account + realm + collectionName
 * @param accountName
 * @param realmName
 * @param collectionName
 * @param cb
 * @returns {*}
 */
function getCollection(accountName, realmName, collectionName, cb) {
    //TODO: used all over
    getCollectionWithOptions(accountName, realmName, collectionName, {strict: false}, cb);
}

module.exports.getCollection = getCollection;

/**
 * get a collection mapped from a given account + realm + collectionName
 * This should be called with a filled in options block to create an indexed collection
 * @param accountName
 * @param realmName
 * @param collectionName
 * @param options an options object containing externally defined options for indexing
 * @param cb
 * @returns {*}
 */
function createIndexedCollection(accountName, realmName, collectionName, options, cb) {

    //TODO: looks like it is only used internally in this file
    //      and within the voyent-common lib, nothing external to other services

    const logger = require('./loggers').getLogger();

    return getDatabase(accountName, function (dbErr, db) {

        if (dbErr) {
            logger.error('problem getting client', dbErr);
            return cb(dbErr, null);
        }
        let fullCollectionName = realmName + '.' + collectionName;

        options.w = 1;
        db.createCollection(fullCollectionName, options, function (createErr, newCollection) {
            if (createErr) {
                logger.error('could not create collection', createErr);
                return cb(createErr, null);
            }
            //logger.debug('created new collection', newCollection.collectionName);
            return cb(null, newCollection);
        });
    });
}

module.exports.createIndexedCollection = createIndexedCollection;

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

    //TODO: looks like it is only used internally in this file

    const logger = require('./loggers').getLogger();
    const capSize = capsize || 100000;

    return getDatabase(accountName, function (dbErr, db) {

        if (dbErr) {
            logger.error('problem getting client', dbErr);
            return cb(dbErr, null);
        }

        let fullCollectionName = realmName + '.' + collectionName;
        //logger.debug('getting client for: ' + accountName + ' -> ' + fullCollectionName);

        db.collection(fullCollectionName, {strict: false}, function (collErr, coll) {

            if (collErr) {
                logger.error('problem getting reference to collection', collErr);
                return cb(collErr, null);
            }

            if (coll) {
                //logger.debug('found existing collection', coll.collectionName);
                return cb(null, coll);
            }
            // Apparently we can only cap a collection when creating one
            // or when there are no records.
            let options = {
                w: 1,
                capped: true,
                count: capSize
            };
            db.createCollection(fullCollectionName, options, function (createErr, newCollection) {
                if (createErr) {
                    logger.error('could not create collection', createErr);
                    return cb(createErr, null);
                }
                //logger.debug('created new collection', newCollection.collectionName);
                return cb(null, newCollection);
            });

        });
    });
}

module.exports.getCappedCollection = getCappedCollection;


/**
 * This was created for early testing purposes for when we did our own caching
 * and sandboxing.  It's no just a noop in case someone is calling it.
 */
function shutdown() {

    const logger = require('./loggers').getLogger();
    logger.debug('db.shutdown is not supported (noop)');

}

module.exports.shutdown = shutdown;
