var errors = require('./errors');
var db = require('./db');
var btools = require('./tools');
var authCall = require('./authCall');
var metrics = require('./metrics');
var ObjectID = require('mongodb').ObjectID;
var uuid = require('uuid');
var util = require('util');
var us = require('underscore');
var httpClient = require('request');
var ZSchema = require('z-schema');
var zs = new ZSchema();


function verifyAccount(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('verifying account');

    barrel.accountId = barrel.req.params.accountId;
    if (!barrel.accountId) {
        return cb(new errors.BadRequestError('requestMissingAccount'));
    }

    cb(null, barrel);
}
module.exports.verifyAccount = verifyAccount;


function verifyRealm(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('verifying realm');

    barrel.realmId = barrel.req.params.realmId;
    if (!barrel.realmId) {
        return cb(new errors.BadRequestError('requestMissingRealm'));
    }

    cb(null, barrel);
}
module.exports.verifyRealm = verifyRealm;


function verifyAccessToken(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('verifying access_token');

    barrel.accessToken = btools.getAccessToken(barrel.req);
    if (!barrel.accessToken) {
        return cb(new errors.BadRequestError('requestMissingAccessToken'));
    }

    cb(null, barrel);
}
module.exports.verifyAccessToken = verifyAccessToken;


function checkPermission(barrel, cb) {

    var logger = require('./loggers').getLogger();

    btools.getOrigin(barrel.req, function (err, origin) {

        if (err) {
            logger.debug('problem determining origin', err);
            return cb(err);
        }

        //Make sure the access_token has permission to do this action.
        authCall.checkPermissions(barrel.accountId, barrel.realmId, origin, barrel.accessToken, barrel.permission, function (err, results) {

            if (err) {
                logger.debug('permission check failed', err);
                return cb(err);
            }

            logger.debug('permission check results', results);

            barrel.origin = origin;
            barrel.permissionCheck = results;
            cb(null, barrel);
        });
    });
}
module.exports.checkPermission = checkPermission;


function getCollection(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('getting database collection: ' + barrel.accountId + ' -> ' + barrel.realmId + '.' + barrel.collectionName);

    db.getCollection(barrel.accountId, barrel.realmId, barrel.collectionName, function (err, coll) {
        if (err) {
            logger.error('could not get collection: ' + barrel.accountId + ' -> ' + barrel.realmId + '.' + barrel.collectionName, err);
            return cb(new errors.ServerDetailsError('databaseError', err));
        }

        barrel.collection = coll;

        //Ensure that the appropriate index is set for the collection as
        //they are mandatory for geospatial queries.
        if (barrel.collectionIndex) {
            coll.ensureIndex(barrel.collectionIndex, function (indexError, indexName) {
                if (indexError) {
                    logger.error('could not create index: ' + indexError);
                    return cb(new errors.ServerDetailsError('databaseError', indexError));
                }
                logger.debug('index applied: ' + indexName);
                return cb(null, barrel);
            });
        } else {
            return cb(null, barrel);
        }
    });
}
module.exports.getCollection = getCollection;


function validatePayload(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('validating payload');

    var payload = btools.getBodyAsJSON(barrel.req);

    logger.debug('payload: ' + JSON.stringify(payload));

    if (!payload) {
        return cb(new errors.BadRequestDetailsError('requestMissingOrInvalidPayload'), 'no payload in body of request');
    }

    if (payload instanceof Array) {
        return cb(new errors.BadRequestDetailsError('requestMissingOrInvalidPayload'), 'payload cannot be an array');
    }

    barrel.payload = payload;

    return cb(null, barrel);
}
module.exports.validatePayload = validatePayload;


function processResultsParameter(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('processing parameter [results]');

    //Default value to return all records
    barrel.resultsScope = 'all';

    if (barrel.req.query) {

        if (barrel.req.query.results) {
            barrel.resultsScope = barrel.req.query.results;
            if (barrel.resultsScope !== 'all' && barrel.resultsScope !== 'one') {
                var errorMessage = {
                    parameter: 'results',
                    message: 'received -> ' + barrel.resultsScope,
                    error: 'invalid value (must be all|one)'
                };
                logger.warn(JSON.stringify(errorMessage));
                return cb(new errors.BadRequestDetailsError('requestBadParameter'), errorMessage);
            }
        }
    }

    logger.debug('results parameter: ' + JSON.stringify(barrel.resultsScope));

    return cb(null, barrel);
}
module.exports.processResultsParameter = processResultsParameter;


function processQueryParameter(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('processing query parameter [query]');

    //Default search is basically everything.  However, if
    //a resourceId path parameter is supplied, that becomes
    //the de-facto search criteria.  If not, we then check
    //to see if an actual 'query' parameter was provided and
    //use that.
    barrel.searchQuery = {};

    if (barrel.req.query) {

        if (barrel.req.query.query) {
            try {
                barrel.searchQuery = JSON.parse(barrel.req.query.query);
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'query',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                return cb(new errors.BadRequestDetailsError('requestBadParameter'), errorMessage);
            }
        }
    }

    if (barrel.req.params.resourceId) {
        barrel.searchQuery._id = barrel.req.params.resourceId;
    }

    logger.debug('query parameter: ' + JSON.stringify(barrel.searchQuery));

    return cb(null, barrel);
}
module.exports.processQueryParameter = processQueryParameter;


function processFieldsParameter(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('processing query parameter [fields]');

    //Default value is to return all fields
    barrel.fieldsFilter = {};

    //Check and process which query parameters were provided.
    if (barrel.req.query) {

        if (barrel.req.query.fields) {
            try {
                barrel.fieldsFilter = JSON.parse(barrel.req.query.fields);
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'fields',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                return cb(new errors.BadRequestDetailsError('requestBadParameter'), errorMessage);
            }
        }
    }

    logger.debug('fields parameter: ' + JSON.stringify(barrel.fieldsFilter));

    cb(null, barrel);
}
module.exports.processFieldsParameter = processFieldsParameter;


function processOptionsParameter(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('processing query parameter [options]');

    //Default value is to set no options.
    barrel.queryOptions = {};
    if (barrel.req.query) {

        if (barrel.req.query.options) {
            try {
                barrel.queryOptions = JSON.parse(barrel.req.query.options);
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'options',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                return cb(new errors.BadRequestDetailsError('requestBadParameter'), errorMessage);
            }
        }

    }

    if (!barrel.queryOptions.limit) {
        barrel.queryOptions.limit = 50;
    }

    logger.debug('options parameter: ' + JSON.stringify(barrel.queryOptions));

    cb(null, barrel);
}
module.exports.processOptionsParameter = processOptionsParameter;


function validateResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('validating resource');

    if (barrel.resValidator) {
        //Validate the document against the schema.
        zs.validate(barrel.payload, barrel.resValidator, function (err, report) {

            if (err) {
                return cb(new errors.BadRequestDetailsError('requestMissingOrInvalidPayload'), err);
            }
            barrel.validatedResource = barrel.payload;
            return cb(null, barrel);
        });
    } else {
        //If no validation is done, just set the payload as the validated value.
        barrel.validatedResource = barrel.payload;
        cb(null, barrel);
    }

}
module.exports.validateResource = validateResource;


function validateResourceId(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('validating resource id');

    //Depending on the operation involved, it's possible that the id of the
    //resource could be provided by:
    // - a path parameter called {resourceId}
    // - as a query parameter (e.g. {"_id":"xxxx"}
    // - as part of the payload (e.g. POST, PUT)
    //So we need to make sure they all match to prevent unintentional actions

    var err;
    var currentId;

    //If there is a path parameter, start with that as our comparison
    if (barrel.req.params && barrel.req.params.resourceId) {
        currentId = barrel.req.params.resourceId;
        logger.debug('resourceId (path) provided: ' + currentId);
    }

    //See if there is a query parameter and if an _id was included
    if (barrel.searchQuery && barrel.searchQuery._id) {
        logger.debug('query id: ' + barrel.searchQuery._id);

        //If there is no currentId, set it here for future checking
        if (!currentId) {
            currentId = barrel.searchQuery._id;
            logger.debug('query (param) id provided: ' + currentId);
        } else {
            //Compare ids to ensure they are the same
            if (barrel.searchQuery._id !== currentId) {
                err = {
                    message: 'different id values detected: ' + barrel.searchQuery._id + ' != ' + currentId,
                    error: 'resource id mismatch'
                };
                logger.warn(JSON.stringify(err));
                return cb(new errors.BadRequestDetailsError('requestBadParameter'), err);
            }
        }
    }

    //See if there is a payload and if an _id was included in there
    if (barrel.validatedResource && barrel.validatedResource._id) {

        logger.debug('resource id: ' + barrel.validatedResource._id);

        if (!currentId) {
            currentId = barrel.validatedResource._id;
            logger.debug('resource (body) id provided: ' + currentId);
        } else {
            if (barrel.validatedResource._id !== currentId) {
                err = {
                    message: 'different id values detected: ' + barrel.validatedResource._id + ' != ' + currentId,
                    error: 'resource _id mismatch'
                };
                logger.warn(JSON.stringify(err));
                return cb(new errors.BadRequestDetailsError('requestBadParameter'), err);
            }
        }
    }

    cb(null, barrel);
}
module.exports.validateResourceId = validateResourceId;


function normalizeResourceId(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('normalizing resource id');

    var officialResourceId;

    if (barrel.req.params && barrel.req.params.resourceId) {
        officialResourceId = barrel.req.params.resourceId;
        logger.debug('resourceId (path) is official: ' + officialResourceId);
    }

    if (barrel.validatedResource) {
        if (!officialResourceId && barrel.validatedResource._id) {
            officialResourceId = barrel.validatedResource._id;
            logger.debug('resource (body) is official: ' + officialResourceId);
        }
    }

    if (barrel.searchQuery) {
        if (!officialResourceId && barrel.searchQuery._id) {
            officialResourceId = barrel.searchQuery._id;
            logger.debug('search (query) is official: ' + officialResourceId);
        }
    }

    logger.debug('official resource id: ' + officialResourceId);

    if (!officialResourceId && (barrel.req.method === 'POST' || barrel.req.method === 'PUT')) {
        officialResourceId = uuid.v4();
        logger.debug('resource id generated: ' + officialResourceId);
    }

    if (officialResourceId) {

//        if (barrel.validatedResource) {
//            barrel.validatedResource._id = officialResourceId;
//        }
        barrel.validatedResourceId = officialResourceId;

        //It must be a 24 character hex string to have a chance of being an official MongoDB _id
        //and not just a custom String.
        if (/^[0-9a-fA-F]{24}$/.test(officialResourceId)) {
            barrel.searchQuery = {_id: ObjectID.createFromHexString(officialResourceId)};
        } else {
            barrel.searchQuery = {_id: officialResourceId};
        }
    }

    cb(null, barrel);
}
module.exports.normalizeResourceId = normalizeResourceId;


function findResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('finding resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.searchQuery) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    if (barrel.resultsScope === 'all') {
        barrel.collection.find(barrel.searchQuery, barrel.fieldsFilter, barrel.queryOptions).toArray(function (err, results) {

            if (err) {
                return cb(new errors.ServerDetailsError('databaseError', err));
            }

            if (!results || results.length === 0) {
                return cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
            }

            barrel.results = results;
            cb(null, barrel);
        });
    } else {
        barrel.collection.findOne(barrel.searchQuery, barrel.fieldsFilter, barrel.queryOptions, function (err, results) {

            if (err) {
                return cb(new errors.ServerDetailsError('databaseError', err));
            }

            if (!results || results.length === 0) {
                return cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
            }

            barrel.results = results;
            cb(null, barrel);
        });
    }
}
module.exports.findResource = findResource;


function findResourceById(barrel, cb) {
    var logger = require('./loggers').getLogger();
    barrel.searchQuery = {_id: barrel.req.params.resourceId};
    barrel.resultsScope = 'one';
    logger.debug('finding resource by id', barrel.searchQuery);
    findResource(barrel, cb);
}
module.exports.findResourceById = findResourceById;


function removeResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('removing resource(s)');

    barrel.collection.remove(barrel.searchQuery, {w: 1}, function (err, numberOfDocs) {

        if (err) {
            return cb(new errors.ServerDetailsError('databaseError', err));
        }

        if (numberOfDocs === 0) {
            return cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
        }

        barrel.results = numberOfDocs;
        cb(null, barrel);
    });

}
module.exports.removeResource = removeResource;


function removeResourceById(barrel, cb) {
    var logger = require('./loggers').getLogger();
    barrel.searchQuery = {_id: barrel.req.params.resourceId};
    logger.debug('removing resource by id', barrel.searchQuery);
    removeResource(barrel, cb);
}
module.exports.removeResourceById = removeResourceById;


function insertResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (barrel.validatedResourceId) {
        barrel.validatedResource._id = barrel.validatedResourceId;
    }

    logger.debug('inserting resource with: ' +
        '\n  res     = ' + JSON.stringify(barrel.validatedResource)
    );

    barrel.collection.insert(barrel.validatedResource, {w: 1}, function (err, doc) {

        if (err) {
            logger.error('could not insert resource', err);
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.insertResource = insertResource;


function saveResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('saving resource with: ' +
        '\n  res     = ' + JSON.stringify(barrel.validatedResource)
    );

    barrel.collection.save(barrel.validatedResource, {w: 1}, function (err, result) {

        if (err) {
            logger.error('could not save resource', err);
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        if (result === 1) {
            logger.debug('saved (updated) existing resource', result);
        } else {
            logger.debug('saved (inserted) new resource', result);
        }

        barrel.results = result;
        cb(null, barrel);

    });
}
module.exports.saveResource = saveResource;


function updateResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (!barrel.queryOptions) {
        barrel.queryOptions = {};
    }

    //Always set upsert to allow creating new records if it isn't already set.
    if (barrel.queryOptions.upsert === undefined || barrel.queryOptions.upsert !== false) {
        barrel.queryOptions.upsert = true;
    }

    logger.debug('updating resource with: ' +
        '\n  res     = ' + JSON.stringify(barrel.validatedResource) +
        '\n  query   = ' + JSON.stringify(barrel.searchQuery) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.update(barrel.searchQuery, barrel.validatedResource, barrel.queryOptions, function (err, numberOfDocs) {

        if (err) {
            return cb(new errors.ServerDetailsError('databaseError', err));
        }

        if (!numberOfDocs || numberOfDocs.length === 0) {
            return cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
        }

        barrel.results = numberOfDocs;
        cb(null, barrel);

    });
}
module.exports.updateResource = updateResource;


function calculateResourceURL(protocol, host, port, path, resourceId) {

    var logger = require('./loggers').getLogger();
    logger.debug('calculating resource URL from: ' +
        '\n  protocol   = ' + protocol +
        '\n  host       = ' + host +
        '\n  port       = ' + port +
        '\n  path       = ' + path +
        '\n  resourceId = ' + resourceId
    );

    var resourceLocation = protocol + '://' + host;

    if (port && !isNaN(port) && port !== 80) {
        resourceLocation += ':' + port;
    }

    resourceLocation += path;

    //If there is a resourceId, check if the path already has
    //it.  If not, then append it.
    if (resourceId) {
        var resIdPattern = new RegExp('\/' + resourceId + '$');
        if (!(path.match(resIdPattern))) {
            resourceLocation += '/' + resourceId;
        }
    }

    return resourceLocation;
}
module.exports.calculateResourceURL = calculateResourceURL;
