var config = require('./config');
var MongoClient = require('mongodb').MongoClient;
var util = require('util');
var us = require('underscore');

//The prefix of the URL used to connect to the database.  The name of the database (account) is appended to the end
var dbURLPrefix = config.database.scheme + '://' + config.database.host + ':' + config.database.port + '/';

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

//Debugging counters
var stats = {
    strategy: (config.database.sharedConnections ? 'shared' : 'not shared'),
    collectionRequests: 0,
    realmCacheHits: 0,
    accountCacheHits: 0,
    accountNameQueries: 0,
    dbClientCreated: 0,
    dbClientDestroyed: 0,
    collectionCreated: 0,
    collectionFound: 0
};


//The accounts collection is the one used to query the database directly and, like the function
//getAccountNameForRealm shouldn't really be necessary once we have a service call in place.
function getAccountsCollection(cb) {

    var logger = require('./loggers').getLogger();

    if (accountsCollection) {
        return cb(null, accountsCollection);
    }

    var dbURL = dbURLPrefix + 'auth';
    logger.debug('dbURL ' + dbURL);

    MongoClient.connect(dbURL, function (err, db) {

        if (err) {
            logger.error('problem connecting to MongoDB @ ' + dbURL, err);
            return cb(err, null);
        }

        logger.debug('getting accounts collection via ' + dbURL);
        db.collection('bridgeit.auth.accounts', {strict: true}, function (collErr, coll) {

            if (err) {
                logger.error('could not get accounts collection from ' + dbURL, err);
                return cb(err, null);
            }

            accountsCollection = coll;
            return cb(null, accountsCollection);
        });

    });
}
module.exports.getAccountsCollection = getAccountsCollection;

//This is temporary as it directly queries the database rather than making a service call.
//We will need an "official" way to get the account for the realm but we should only need
//this information if the connection is not already cached.  The database query does assume
//that the account and realm names are globally unique.
function getAccountNameForRealm(realmName, cb) {

    var logger = require('./loggers').getLogger();

    ++stats.accountNameQueries;

    getAccountsCollection(function (err, accountsCollection) {

        if (err) {
            logger.error('problem connecting to auth database', err);
            return cb(err, null);
        }

        var query = {realms: {$all: [
            {$elemMatch: {"name": realmName} }
        ] } };

        var fields = {_id: false, accountname: true};

        logger.debug('preparing to get account for ' + realmName + ' from ' + accountsCollection.collectionName);
        accountsCollection.findOne(query, fields, function (err, doc) {

            if (err) {
                logger.error('error occurred trying to find account for ' + realmName, err);
                return cb(err, null);
            }

            if (!doc) {
                logger.error('could not find account for ' + realmName);
                return cb({err: 'could not find account for ' + realmName}, null);
            }

            return cb(null, doc.accountname);
        });
    });
}
module.exports.getAccountNameForRealm = getAccountNameForRealm;


//The callback returns a MongoDB client connection to the database associated with the account.  This
//approach creates a new client per database and opens a connection pool for each (default 5).  So:
//   total connections used = active databases * 5
//This creates a greater number of connections than the shared strategy below - which creates a single
//pool and shares them with all databases.  Because of this, this function also kicks off an interval
//cache cleaning function to close client connections that haven't been used for a configurable duration.
function getClient(realmName, cb) {

    var logger = require('./loggers').getLogger();

    //Start a cleaner for db connections that haven't been used in awhile
    if (!cacheCleaner) {
        cacheCleaner = setInterval(cleanDBClientCache, config.database.clientExpiry);
    }

    //If there is a cached dbClient using the realm name,
    //update the time it was requested and return it.
    var realmClient = dbClients[realmName];
    if (realmClient) {
        realmClient.touched = Date.now();

        //Also update the cached account entry so that other realms that use
        //it don't get expired prematurely.
        var accountClient = dbClients[realmClient.account];
        if (accountClient) {
            accountClient.touched = Date.now();
        } else {
            //Should never happen
            logger.warn('no account associated with realm');
        }

        logger.debug('realm client retrieved from cache');
        ++stats.realmCacheHits;

        return cb(null, realmClient.database);
    }

    //If there is no cached dbClient, then we need to get the account name for the
    //realm so that we can make the proper connection.
    getAccountNameForRealm(realmName, function (err, accountName) {

        if (err) {
            logger.error('problem getting account name for realm ' + realmName, err);
            return cb(err, null);
        }

        var safeAccountName = getSafeDatabaseName(accountName);

        //Check if we have the database connection cached keyed to the account
        var accountClient = dbClients[safeAccountName];
        if (accountClient) {
            accountClient.touched = Date.now();

            logger.debug('account client retrieved from cache');
            ++stats.accountCacheHits;

            return cb(null, accountClient.database);
        }

        //Looks like we don't currently have a database connection so make a new one.
        var dbURL = dbURLPrefix + safeAccountName;
        logger.debug('connecting to ' + dbURL);

        MongoClient.connect(dbURL, function (err, db) {

            if (err) {
                logger.error('problem connecting to MongoDB @ ' + dbURL, err);
                return cb(err, null);
            }

            //Cache the new connection and return it.  We cache it under both the realm
            //name and the account name as all realms will use the same connection pool.
            dbClients[realmName] = {
                touched: Date.now(),
                database: db,
                account: safeAccountName
            };
            dbClients[safeAccountName] = {
                touched: Date.now(),
                database: db
            };
            logger.debug('new realm and account clients added to cache');
            ++stats.dbClientCreated;
            return cb(null, db);
        });
    });
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
    var logger = require('./loggers').getLogger();
    logger.info(JSON.stringify(stats, null, 4));
}
module.exports.dumpStats = dumpStats;


function cleanDBClientCache() {

    var logger = require('./loggers').getLogger();

    us.each(dbClients, function (dbClient, dbClientKey, dbClients) {

        var touched = dbClient.touched;

        //If this is a realm client, then we need to check the account as other realms
        //might have been actively using the connection.
        if (dbClient.account) {
            touched = dbClients[dbClient.account].touched;
        }

        //See if the database connection hasn't been used over the configured expiry duration.
        var timeLeft = (touched + config.database.clientExpiry) - Date.now();
        logger.debug('[' + dbClientKey + ']  expired: ' + (timeLeft < 0) + '  left: ' + timeLeft);

        if (timeLeft < 0) {

            //Need to remove the client from the cache and close the connection.
            dbClient.database.close();

            delete dbClients[dbClientKey];
//            dbClients[dbClientKey] = null;

            ++stats.dbClientDestroyed;
        }
    });
}


//The callback returns a MongoDB client connection to the database associated with the account.  This
//approach is slightly different than the above method in that the various databases try to share the
//same connection pool.  So there are, by default, 5 connections total for all the databases in use and
//there is no cleaner interval function required.
function getClientShared(realmName, cb) {

    var logger = require('./loggers').getLogger();

    //If we have not yet established a single database connection, then do it now.
    if (!initialDB) {

        //Find the account name for the realm provided.
        getAccountNameForRealm(realmName, function (err, accountName) {

            if (err) {
                if (err) {
                    logger.error('problem getting account name ' + realm, err);
                    return cb(err, null);
                }
            }

            //Make sure the database name is safe to use.
            var safeAccountName = getSafeDatabaseName(accountName);
            var dbURL = dbURLPrefix + safeAccountName;
            logger.debug('connecting to initial database ' + dbURL);

            //Make the actual connection.
            MongoClient.connect(dbURL, function (err, db) {

                if (err) {
                    logger.error('problem connecting to MongoDB @ ' + dbURL, err);
                    return cb(err, null);
                }

                //Save the initial db reference
                initialDB = db;
                logger.debug('initial database set');

                //Cache the initial connection and return the db.
                dbClients[safeAccountName] = {
                    touched: Date.now(),
                    database: db
                };

                logger.debug('initial account client added to cache');
                ++stats.dbClientCreated;

                return cb(null, db);
            });
        });


    } else {

        //If there is a cached dbClient for the realm, update the time it was requested and return it.
        var realmClient = dbClients[realmName];
        if (realmClient) {
            realmClient.touched = Date.now();

            //Also update the cached account entry so that other realms that use
            //it don't get expired prematurely.
            var accountClient = dbClients[realmClient.account];
            if (accountClient) {
                accountClient.touched = Date.now();
            } else {
                //Should never happen
                logger.warn('no account associated with realm');
            }

            logger.debug('realm client retrieved from cache ' + realmName);
            ++stats.realmCacheHits;

            return cb(null, realmClient.database);
        } else {
            logger.debug('[' + realmName + '] not cached in ' + JSON.stringify(us.keys(dbClients), null, 4));
        }

        //Otherwise we need to get the account name and see if we cached that.
        getAccountNameForRealm(realmName, function (err, accountName) {

            if (err) {
                logger.error('problem getting account name for ' + realm, err);
                return cb(err, null);
            }

            //Make sure the database name is safe to use.
            var safeAccountName = getSafeDatabaseName(accountName);
            logger.debug('using safe account name ' + safeAccountName);

            var accountClient = dbClients[safeAccountName];
            if (accountClient) {
                accountClient.touched = Date.now();

                //If we had an account but not a realm in the cache, we can add the realm
                //now for future requests as getting it based on the realm is more efficient
                //since it doesn't have to query for the account next time.
                dbClients[realmName] = {
                    touched: Date.now(),
                    database: accountClient.database,
                    account: safeAccountName
                };

                logger.debug('account client retrieved from cache: ' + safeAccountName);
                ++stats.accountCacheHits;

                return cb(null, accountClient.database);
            }

            //If there is nothing cached, create a new one using the initial one.
            var dbWithSharedConnections = initialDB.db(safeAccountName);

            //Cache the newly created client
            dbClients[realmName] = {
                touched: Date.now(),
                database: dbWithSharedConnections,
                account: safeAccountName
            };
            dbClients[safeAccountName] = {
                touched: Date.now(),
                database: dbWithSharedConnections
            };

            logger.debug('shared client added to cache');
            ++stats.dbClientCreated;

            return cb(null, dbWithSharedConnections);
        });

    }
}
module.exports.getClientShared = getClientShared;


function getCollection(realmName, collectionName, cb) {

    var logger = require('./loggers').getLogger();
    ++stats.collectionRequests;

    return getClientStrategy(realmName, function (dbErr, db) {

        if (dbErr) {
            logger.error('problem getting client', dbErr);
            return cb(dbErr, null);
        }

        var fullCollectionName = realmName + '.' + collectionName;
        logger.debug('getting client for: ' + fullCollectionName);

        db.collection(fullCollectionName, {strict: true}, function (collErr, coll) {

            if (collErr) {
                logger.error('trying to acquire collection in strict mode', collErr);
//                return cb(collErr, null);
            }

            if (coll) {
                logger.debug('found existing collection', coll.collectionName);
                ++stats.collectionFound;
                return cb(null, coll);
            }

            //We've set 'strict' so collections are not automatically created when asked for
            //but we should add some logic here to ensure that the collection we are planning
            //to create manually is legal and authorized.  Part of the work is done when
            //the service call to get the account name for the realm is made and that might be
            //enough.
            db.createCollection(fullCollectionName, {w: 1}, function (createErr, newCollection) {
                if (createErr) {
                    logger.error('could not create collection', createErr);
                    return cb(createErr, null);
                }
                logger.debug('created new collection', newCollection.collectionName);
                ++stats.collectionCreated;
                return cb(null, newCollection);
            });

        });
    });
}
module.exports.getCollection = getCollection;


//This should probably only be used for the purposes of testing as you may
//not want to cut connections drastically during production service shutdown.
function shutdown() {

    var logger = require('./loggers').getLogger();
    logger.debug('shutting down database clients...');

    us.each(dbClients, function (dbClient, cacheKey, dbClients) {
        logger.debug('[' + cacheKey + ']  closing');
        dbClient.database.close();
        delete dbClients[cacheKey];
    });

    if (cacheCleaner) {
        clearInterval(cacheCleaner);
    }

}
module.exports.shutdown = shutdown;
