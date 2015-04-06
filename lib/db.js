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


//These are the default options for a db instance (rather than server, replicate set, and mongos)
//var dbOptions = {
//    db: {
//        bufferMaxEntries: -1,
//        retryMiliSeconds: 5000,
//        numberOfRetries: 5
//    }
//};
var dbOptions = {
    db: {
        bufferMaxEntries: -1,
        retryMiliSeconds: 5000,
        numberOfRetries: 5
    }
};

//Debugging counters
var stats = {
    strategy: (config.database.sharedConnections ? 'shared' : 'not shared'),
    collectionRequests: 0,
    cacheHits: 0,
    dbClientCreated: 0,
    dbClientDestroyed: 0,
    collectionCreated: 0,
    collectionFound: 0
};


//The callback returns a MongoDB client connection to the database associated with the account.  This
//approach creates a new client per database and opens a connection pool for each (default 5).  So:
//   total connections used = active databases * 5
//This creates a greater number of connections than the shared strategy below - which creates a single
//pool and shares them with all databases.  Because of this, this function also kicks off an interval
//cache cleaning function to close client connections that haven't been used for a configurable duration.
function getClient(accountName, cb) {

    //var logger = require('./loggers').getLogger();

    //Start a cleaner for db connections that haven't been used in awhile
    if (!cacheCleaner) {
        cacheCleaner = setInterval(cleanDBClientCache, config.database.clientExpiry);
    }

    //If there is a cached dbClient using the account name,
    //update the time it was requested and return it.
    var dbClient = dbClients[accountName];
    if (dbClient) {
        dbClient.touched = Date.now();

        //logger.debug('db client retrieved from cache');
        stats.cacheHits += 1;

        return cb(null, dbClient.database);
    }

    //Looks like we don't currently have a database connection so make a new one.
    var dbURL = dbURLPrefix + accountName;
    //logger.debug('connecting to ' + dbURL);

    //Make the actual connection.  We may want to check with Auth service as to
    //whether this is a real account and only create it it should be created.
    MongoClient.connect(dbURL, dbOptions, function (err, db) {

        if (err) {
            //logger.error('problem connecting to MongoDB @ ' + dbURL, err);
            return cb(err, null);
        }
        // Perform a late check for a dbClient collision. It's possible for a race condition to
        // occur here and to have several attempts to fetch connections for a given account. If we
        // find a record for a given account, close the one we just got (sorry) and return the original
        if (dbClients[accountName]) {
            db.close();
            dbClients[accountName].touched = Date.now();
            stats.cacheHits += 1;
            return cb(null, dbClients[accountName].database);
        }

        //Cache the new connection and return it.  We cache it under both the realm
        //name and the account name as all realms will use the same connection pool.
        dbClients[accountName] = {
            touched: Date.now(),
            database: db
        };
        //logger.debug('new db client added to cache: ' + accountName);
        stats.dbClientCreated += 1;
        return cb(null, db);
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
    //var logger = require('./loggers').getLogger();
    //logger.info(JSON.stringify(stats, null, 4));
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


function getCollection(accountName, realmName, collectionName, cb) {

    //var logger = require('./loggers').getLogger();
    stats.collectionRequests += 1;

    return getClientStrategy(accountName, function (dbErr, db) {

        if (dbErr) {
            //logger.error('problem getting client', dbErr);
            return cb(dbErr, null);
        }

        var fullCollectionName = realmName + '.' + collectionName;
        //logger.debug('getting client for: ' + accountName + ' -> ' + fullCollectionName);

        db.collection(fullCollectionName, {strict: false}, function (collErr, coll) {

            if (collErr) {
                //logger.error('problem getting reference to collection', collErr);
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
                    //logger.error('could not create collection', createErr);
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
