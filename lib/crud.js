var config = require('./config');
var errors = require('./errors');
var db = require('./db');
var btools = require('./tools');
var authCall = require('./authCall');
var metrics = require('./metrics');
var ObjectID = require('mongodb').ObjectID;
var uuid = require('uuid');
var ld = require('lodash');
var url = require('url');
var util = require('util');
var us = require('underscore');
var fs = require('fs');
var agent = require('superagent');
var JSONSchemaValidator = require('jsonschema').Validator;


/**
 * Any request coming into a service should first be processed by the
 * Auth Proxy where a number of validation/verification/auth* checks
 * are made.  Assuming these pass, then the request can be assumed to
 * meet a number of requirements.  This includes having a set of
 * headers set that the service can use (username, permissions).
 *
 * This function does some initial work like processing those headers,
 * checking the permission, etc.  The request will be rejected if it
 * does not have the appropriate permissions.
 *
 * @param barrel
 * @param cb
 */
function verifyPermission(barrel, cb) {

    //If we are not using the Auth Proxy, we don't exercise this function
    if (!config.proxy.enabled) {
        cb(null, barrel);
        return;
    }

    var logger = require('./loggers').getLogger();
    logger.debug('verifying permission, authProxy enabled' +
        ', incoming permissions: '+ btools.getUserPermissionsHeader(barrel.req));

    //Headers should have been provided by the Auth Proxy.  If not,
    //then there is something wrong.
    barrel.username = btools.getUserNameHeader(barrel.req);
    if (!barrel.username) {
        logger.error('missing username header');
        cb(new errors.AuthorizationError('invalidUsername'));
        return;
    }

    //If a permission is provided, check that the permission is one of the
    //allowed permissions provided in the user or service permission headers.
    if (barrel.permission) {

        if (!btools.hasPermissionInHeader(barrel.req, barrel.permission)) {
            cb(new errors.AuthorizationError('permissionNotGranted'));
            return;
        }
    }

    //Get the account and realm.  This should already have been verified
    //by the Auth Proxy and we just put them in the barrel for convenience.
    barrel.accountId = db.getSafeDatabaseName(barrel.req.params.accountId);
    barrel.realmId = barrel.req.params.realmId;

    cb(null, barrel);
}
module.exports.verifyPermission = verifyPermission;


function verifyAccount(barrel, cb) {

    //If we are using the Auth Proxy, we don't exercise this function
    if (config.proxy.enabled) {
        cb(null, barrel);
        return;
    }

    var logger = require('./loggers').getLogger();
    logger.debug('verifying account');

    if (!barrel.req.params.accountId) {
        cb(new errors.BadRequestError('requestMissingAccount'));
        return;
    }
    barrel.accountId = db.getSafeDatabaseName(barrel.req.params.accountId);

    cb(null, barrel);
}
module.exports.verifyAccount = verifyAccount;


function verifyRealm(barrel, cb) {

    //If we are using the Auth Proxy, we don't exercise this function
    if (config.proxy.enabled) {
        cb(null, barrel);
        return;
    }

    var logger = require('./loggers').getLogger();
    logger.debug('verifying realm');

    barrel.realmId = barrel.req.params.realmId;
    if (!barrel.realmId) {
        cb(new errors.BadRequestError('requestMissingRealm'));
        return;
    }

    cb(null, barrel);
}
module.exports.verifyRealm = verifyRealm;


function verifyAccessToken(barrel, cb) {

    //If we are using the Auth Proxy, we don't exercise this function
    if (config.proxy.enabled) {
        cb(null, barrel);
        return;
    }

    var logger = require('./loggers').getLogger();
    logger.debug('verifying access_token');

    barrel.accessToken = btools.getAccessToken(barrel.req);
    if (!barrel.accessToken) {
        cb(new errors.BadRequestError('requestMissingAccessToken'));
        return;
    }

    cb(null, barrel);
}
module.exports.verifyAccessToken = verifyAccessToken;


function checkPermission(barrel, cb) {

    //A permission can either be static or dynamic.  We need to determine which
    //before continuing.
    if (!barrel.permission) {

        //If the services requires a dynamic permission, then the check is
        //a bit different.  The permission is the static prefix followed
        //by the resource (e.g. context or flow) id.
        if (barrel.dynamicPermission) {

            if (barrel.req.params && barrel.req.params.resourceId) {
                barrel.permission = barrel.dynamicPermission + barrel.req.params.resourceId;
            }
        }
    }

    //If we are using the Auth Proxy, we don't exercise the rest of this
    //function. Instead, we call the verifyPermission function which is
    //designed to work with the Auth Proxy.
    if (config.proxy.enabled) {
        verifyPermission(barrel, cb);
        return;
    }

    var logger = require('./loggers').getLogger();

    var origin;
    try {
        origin = btools.getOrigin(barrel.req);
    } catch (e) {
        logger.debug('problem determining origin', e);
        return cb(e);
    }
    var op = 'and';
    if (barrel.op) {
        op = barrel.op;
    }

    //Make sure the access_token has permission to do this action.
    authCall.completeCheckPermissions(barrel.accountId, barrel.realmId, origin, barrel.accessToken, barrel.permission, op, function (err, results) {

        if (err) {
            logger.debug('permission check failed', err);
            cb(err);
            return;
        }

        logger.debug('permission check results', results);

        barrel.origin = origin;
        barrel.permissionCheck = typeof results === 'string' ? JSON.parse(results) : results;
        cb(null, barrel);
    });
}
module.exports.checkPermission = checkPermission;


function isValidCollectionName(collectionName) {

    var logger = require('./loggers').getLogger();
    logger.debug('validating database collection name: ' + collectionName);

    //The rules for collection names are that they should
    //  - start with an underscore or letter
    //and cannot:
    //  - be longer than 122 bytes
    //  - contain the $
    //  - be an empty string (e.g. "")
    //  - contain the null character
    //  - begin with the "system." prefix which is reserved for internal use
    if (ld.isUndefined(collectionName) ||
        ld.isEmpty(collectionName) || !(ld.isString(collectionName)) ||
        (collectionName.length > 122) ||
        (collectionName.indexOf('$') !== -1) ||
        (collectionName.indexOf('system.') === 0)) {
        return false;
    }

    //Regex translation: first character is not letter or underscore
    if (/^[^a-zA-Z_]/.test(collectionName)) {
        return false;
    }

    return true;
}
module.exports.isValidCollectionName = isValidCollectionName;


function getCollection(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('getting database collection: ' + barrel.accountId + ' -> ' + barrel.realmId + '.' + barrel.collectionName);

    db.getCollection(barrel.accountId, barrel.realmId, barrel.collectionName, function (err, coll) {
        if (err) {
            logger.error('could not get collection: ' + barrel.accountId + ' -> ' + barrel.realmId + '.' + barrel.collectionName, err);
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        barrel.collection = coll;

        //Ensure that the appropriate index is set for the collection as
        //they are mandatory for geospatial queries.
        if (barrel.collectionIndex) {
            coll.ensureIndex(barrel.collectionIndex, function (indexError, indexName) {
                if (indexError) {
                    logger.error('could not create index: ' + indexError);
                    cb(new errors.ServerDetailsError('databaseError', indexError));
                    return;
                }
                logger.debug('index applied: ' + indexName);
                cb(null, barrel);
            });
        } else {
            cb(null, barrel);
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
        return cb(new errors.BadRequestDetailsError('requestMissingOrInvalidPayload', 'no payload in body of request'));
    }

    if (payload instanceof Array) {
        return cb(new errors.BadRequestDetailsError('requestMissingOrInvalidPayload', 'payload cannot be an array'));
    }

    barrel.payload = payload;

    return cb(null, barrel);
}
module.exports.validatePayload = validatePayload;


function processQueryIdParameter(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('processing query id parameter [queryId]');

    //A queryId is the unique identifier for a database query that is managed by the
    //Query Service. If one is provided, we get it and use it as the settings for
    //whatever action being performed.
    if (barrel.req.query && barrel.req.query.queryId) {

        var parsedURL = url.parse(config.query.url + '/' + barrel.accountId + '/realms/' + barrel.realmId + '/queries/' + barrel.req.query.queryId);
        logger.debug('query url:', parsedURL);
        logger.debug('query params:', barrel.req.query);

        var queryRequest = agent
            .get(parsedURL)
            .accept('json')
            .query(barrel.req.query)
            .end(function (err, res) {

                if (err || !res.ok) {
                    cb(new errors.ServerDetailsError('serviceRequestError', err));
                    return;
                }

                barrel.namedQuery = res.body[0];
                if (typeof res.body === 'string') {
                    barrel.namedQuery = JSON.parse(res.body);
                }
                logger.debug('named query:', JSON.stringify(barrel.namedQuery, null, 4));

                //After we successfully retrieved the named query, we should update the
                //relevant barrel properties for query, fields, and options then proceed
                //with normal processing.

                barrel.req.query.query = barrel.namedQuery.query;
                barrel.req.query.fields = barrel.namedQuery.fields;
                barrel.req.query.options = barrel.namedQuery.options;

                cb(null, barrel);
            });

    } else {
        cb(null, barrel);
    }
}
module.exports.processQueryIdParameter = processQueryIdParameter;

function processResultsParameter(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('processing parameter [results]');

    //Default value to return all records
    barrel.resultsScope = 'all';

    if (barrel.req.query) {

        if (barrel.req.query.results) {
            barrel.resultsScope = barrel.req.query.results;
            if (barrel.resultsScope !== 'all' && barrel.resultsScope !== 'one' && barrel.resultsScope !== 'last') {
                var errorMessage = {
                    parameter: 'results',
                    message: 'received -> ' + barrel.resultsScope,
                    error: 'invalid value (must be all|one|last)'
                };
                logger.warn(JSON.stringify(errorMessage));
                return cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage));
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
                var theQuery = barrel.req.query.query;
                if (typeof theQuery === 'string') {
                    theQuery = JSON.parse(theQuery);
                }
                barrel.searchQuery = theQuery;
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'query',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                return cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage));
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
                var theFields = barrel.req.query.fields;
                if (typeof theFields === 'string') {
                    theFields = JSON.parse(theFields);
                }
                barrel.fieldsFilter = theFields;
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'fields',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage));
                return;
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
                var theOptions = barrel.req.query.options;
                if (typeof theOptions === 'string') {
                    theOptions = JSON.parse(theOptions);
                }
                barrel.queryOptions = theOptions;
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'options',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage));
                return;
            }
        }

    }

    //If the query option "limit" is not set to a number, then set it to the service default.
    //NTYF-192: If the limit is set to 0, it will fail a basic truthy test so we use the
    //isFinite() call to properly allow for the limit to be 0 - which Mongo understands as
    //being no limit.
    if (!ld.isFinite(barrel.queryOptions.limit)) {
        barrel.queryOptions.limit = config.crud.defaultLimit;
    }

    logger.debug('options parameter: ' + JSON.stringify(barrel.queryOptions));

    cb(null, barrel);
}
module.exports.processOptionsParameter = processOptionsParameter;


function prepareValidator(pathToSwaggerDoc) {

    var valObj = {};
    console.log('reading ' + pathToSwaggerDoc);
    var swagDoc = JSON.parse(fs.readFileSync(pathToSwaggerDoc));
    valObj.schemas = swagDoc.definitions;

    valObj.validator = new JSONSchemaValidator();
    us.each(valObj.schemas, function (schema, schemaName, list) {
        valObj.validator.addSchema(schema, '/' + schemaName.toString());
    });
    return valObj;
}
exports.prepareValidator = prepareValidator;


function validateResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('validating resource');

    if (barrel.validator && barrel.validationSchema) {

        //Validate the document against the schema.
        var validationResult = barrel.validator.validate(barrel.payload, barrel.validationSchema);

        if (validationResult.errors && validationResult.errors.length > 0) {
            logger.error('invalid payload', validationResult.errors);
            cb(new errors.BadRequestDetailsError('requestBadParameter', 'invalid payload'));
            return;
        }
        logger.debug('resource successfully validated', validationResult);
    }

    //If the payload is valid or if no validation is done, set the payload as the validated value.
    barrel.validatedResource = barrel.payload;
    cb(null, barrel);

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
                cb(new errors.BadRequestDetailsError('requestBadParameter', err));
                return;
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
                cb(new errors.BadRequestDetailsError('requestBadParameter', err));
                return;
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


function retrieveServiceTokenAndPermissions(barrel, cb) {

    var logger = require('./loggers').getLogger();


    if (!config.service.tokensEnabled) {
        logger.warn('[config.service.tokens.enabled = ' + config.service.tokensEnabled + ']',
            '** Acquisition of service tokens is disabled. It should be re-enabled in a production environment. **');
        cb(null, barrel);
        return;
    }


    logger.debug('getting service token');

    var params = {
        account: barrel.accountId,
        realm: barrel.realmId,
        endpointId: barrel.validatedResourceId
    };
    logger.debug('retrieve service token parameters', params);

    authCall.retrieveServiceTokenAndPermissions(params, function (err, token) {
        //If we get an error or there is no valid token,
        if (err || !token) {
            cb(new errors.AuthorizationError('no service token', err));
            return;
        }

        barrel.serviceToken = token;

        cb(null, barrel);
    });

}
module.exports.retrieveServiceTokenAndPermissions = retrieveServiceTokenAndPermissions;


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
                cb(new errors.ServerDetailsError('databaseError', err));
                return;
            }

            if (!results || results.length === 0) {

                if (barrel.searchQuery && barrel.searchQuery._id) {
                    cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
                    return;
                }
            }

            barrel.results = !results ? {} : results;
            cb(null, barrel);
        });
    } else {
        barrel.collection.findOne(barrel.searchQuery, barrel.fieldsFilter, barrel.queryOptions, function (err, results) {

            if (err) {
                cb(new errors.ServerDetailsError('databaseError', err));
                return;
            }

            if (!results || results.length === 0) {

                if (barrel.searchQuery && barrel.searchQuery._id) {
                    cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
                    return;
                }
            }
            console.log('findOne results', results);

            barrel.results = !results ? {} : results;
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
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        //Only complain if trying to delete a specific resource
        if (numberOfDocs === 0 && barrel.searchQuery._id) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
            return;
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

    logger.debug('inserting resource: ' +
        '\n  ' + JSON.stringify(barrel.validatedResource)
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

    if (barrel.validatedResourceId) {
        barrel.validatedResource._id = barrel.validatedResourceId;
    }

    logger.debug('saving resource: ' +
        '\n  ' + JSON.stringify(barrel.validatedResource)
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

    //If the search query doesn't have the database _id but we did get one
    //then it should be set directly into the resource if one doesn't already exist.
    if (!barrel.excludeId) {

        if (!barrel.validatedResource._id && barrel.validatedResourceId) {
            barrel.validatedResource._id = barrel.validatedResourceId;
        }

        if (!barrel.validatedResource._id && barrel.searchQuery && barrel.searchQuery._id) {
            barrel.validatedResource._id = barrel.searchQuery._id;
        }
    }

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
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        if (!numberOfDocs || numberOfDocs.length === 0) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
            return;
        }

        barrel.results = numberOfDocs;
        cb(null, barrel);

    });
}
module.exports.updateResource = updateResource;


function aggregate(barrel, cb) {

    var logger = require('./loggers').getLogger();

    //If the search query doesn't have the database _id but we did get one
    //then it should be set directly into the resource if one doesn't already exist.
    if (!barrel.aggregation) {
        barrel.aggregation = [];
    }

    logger.debug('aggregating resources with: ' + JSON.stringify(barrel.aggregation));

    barrel.collection.aggregate(barrel.aggregation, function (err, results) {

        if (err) {
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        if (!results || results.length === 0) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.aggregation)));
            return;
        }

        barrel.results = results;
        cb(null, barrel);

    });
}
module.exports.aggregate = aggregate;


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

    //If the path ends with '/', remove it to help with
    //the next bit of checking and appending.
    var lastCharInPath = path.charAt(path.length - 1);
    if (lastCharInPath === '/') {
        path = path.slice(0, -1);
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


function setResourceLocation(barrel, cb) {

    barrel.resourceLocation = calculateResourceURL(
        barrel.req.protocol,
        config.service.host,
        config.service.resourcePort,
        barrel.req.path,
        barrel.validatedResourceId
    );
    cb(null, barrel);

}
module.exports.setResourceLocation = setResourceLocation;

