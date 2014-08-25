var config = require('./config');
var MongoClient = require('mongodb').MongoClient;
var util = require('util');
var us = require('underscore');

var dbURLPrefix = config.database.scheme + '://' + config.database.host + ':' + config.database.port + '/';
var dbClients = {};
var initialDB;
var cacheCleaner;

//The callback returns a MongoDB client connection to the database associated with the account.  This
//approach creates a new client per database and opens a connection pool for each (default 5).  So:
//   total connections used = active databases * 5
//This creates a greater number of connections than the other strategy below that creates a single
//pool and shares them with all databases.  Because of this, this function also kicks off an interval
//cache cleaning function to close client connections that haven't been used in awhile
function getClient(accountName, cb) {

    var logger = require('./loggers').getLogger();

    //Start a cleaner for db connections that haven't been used in awhile
    if (!cacheCleaner) {
        cacheCleaner = setInterval(cleanDBClientCache, config.database.clientExpiry);
    }

    //If there is a cached dbClient, update the time it was requested and return it.
    var dbClient = dbClients[accountName];
    if (dbClient) {
        dbClient.touched = Date.now();
        logger.debug('existing client retrieved from cache');
        return cb(null, dbClient.database);
    }

    var dbURL = dbURLPrefix + accountName;
    logger.debug('connecting to ' + dbURL);

    MongoClient.connect(dbURL, function (err, db) {

        if (err) {
            logger.error('problem connecting to MongoDB @ ' + dbURL, err);
            return cb(err, null);
        }

        //Cache the new connection and return it.
        dbClients[accountName] = {
            touched: Date.now(),
            database: db
        };
        logger.debug('new client added to cache');
        return cb(null, db);
    });
}
module.exports.getClient = getClient;


function cleanDBClientCache() {

    var logger = require('./loggers').getLogger();

    us.each(dbClients, function (dbClient, dbName, dbClients) {
        var timeLeft = (dbClient.touched + config.database.clientExpiry) - Date.now();
        logger.debug('[' + dbName + ']  touched: ' + dbClient.touched + '  left: ' + timeLeft + '  expired: ' + (timeLeft < 0));
        if (timeLeft < 0) {
            //Need to remove the client from the cache as close.
            dbClient.database.close();
            delete dbClients[dbName];
            logger.debug('closed and purged [' + dbName + ']: ' + (!dbClients[dbName]));
        }
    });
}


//The callback returns a MongoDB client connection to the database associated with the account.  This
//approach is slightly different than the above method in that the various databases try to share the
//same connection pool.  So there are, by default, 5 connections total for all the databases in use and
//there is no cleaner interval function required.
function getClientShared(accountName, cb) {

    var logger = require('./loggers').getLogger();

    if (!initialDB) {
        var dbURL = dbURLPrefix + accountName;
        logger.debug('connecting to initial database ' + dbURL);

        MongoClient.connect(dbURL, function (err, db) {

            if (err) {
                logger.error('problem connecting to MongoDB @ ' + dbURL, err);
                return cb(err, null);
            }

            //Save the initial db reference
            initialDB = db;
            logger.debug('initial database set');

            //Cache the initial connection and return the db.
            dbClients[accountName] = {
                touched: Date.now(),
                database: db
            };
            logger.debug('initial client added to cache');
            return cb(null, db);
        });
    } else {

        //If there is a cached dbClient, update the time it was requested and return it.
        var dbClient = dbClients[accountName];
        if (dbClient) {
            dbClient.touched = Date.now();
            logger.debug('existing client retrieved from cache');
            return cb(null, dbClient.database);
        }

        //If there is nothing cached, create a new one using the initial one.
        var dbWithSharedConnections = initialDB.db(accountName);

        //Cache the newly created client
        dbClients[accountName] = {
            touched: Date.now(),
            database: dbWithSharedConnections
        };
        logger.debug('shared client added to cache');
        return cb(null, dbWithSharedConnections);
    }
}
module.exports.getClientShared = getClientShared;


function getCollection(accountName, realmName, collectionName, cb) {

    var getClientFunc = getClient;

    if (config.database.sharedConnections) {
        getClientFunc = getClientShared;
    }

    return getClientFunc(accountName, function (dbErr, db) {

        if (dbErr) {
            return cb(dbErr, null);
        }

        var fullCollectionName = realmName + '.' + collectionName;

        db.collection(fullCollectionName, {strict: true}, function (collErr, coll) {

            if (coll) {
                return cb(null, coll);
            }

            db.createCollection(fullCollectionName, {w: 1}, function (createErr, newCollection) {
                if (createErr) {
                    return cb(createErr, null);
                }
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

    us.each(dbClients, function (dbClient, dbName, dbClients) {
        logger.debug('[' + dbName + ']  closing');
        dbClient.database.close();
        delete dbClients[dbName];
    });

}
module.exports.shutdown = shutdown;
