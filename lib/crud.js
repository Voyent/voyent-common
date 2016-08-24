var config = require('./config');
var errors = require('./errors');
var db = require('./db');
var btools = require('./tools');
var authCall = require('./authCall');
var event = require('./event');
var ObjectID = require('mongodb').ObjectID;
var uuid = require('uuid');
var ld = require('lodash');
var url = require('url');
var util = require('util');
var us = require('underscore');
var fs = require('fs');
var agent = require('superagent');
var scopes = require('./scopes');
var JSONSchemaValidator = require('jsonschema').Validator;
var validation = require('./validation');

// The prefix portions of resource metadata query clauses, for the role portion
var metaRolePrefix = '_permissions.rights.roles.';
var dataBinPrefix = '_data.';


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
 * ** It should be your goal to remove use of this function with
 * assembleResourceQuery + one of:
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
        cb(new errors.AuthorizationError('invalidUsername'), barrel);
        return;
    }

    //If a permission is provided, check that the permission is one of the
    //allowed permissions provided in the user or service permission headers.
    if (barrel.permission) {

        logger.debug('looking for permission', barrel.permission,
            ' in ', btools.getUserPermissionsHeader(barrel.req));

        if (!btools.hasPermissionInHeader(barrel.req, barrel.permission)) {
            cb(new errors.AuthorizationError('permissionNotGranted'), barrel);
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

/**
 * In the case of create* permissions, there is still a use for checking if a users permission set contains
 * a given permission. This is because the resource permissions approach can't be used if the resource hasn't
 * been created yet. Further, the approach of having authProxy insert the salient information into a set of
 * headers in the forwarded request is also deprecated and instead the permissions are fetched from a shared
 * key/value store. This function removes the notion of fetching the permissions from the request headers and eliminates
 * the use of service permissions (which are obsolete)
 *
 * @param barrel
 * @param cb
 */
function verifyTransactionPermission(barrel, cb) {

    //If we are not using the Auth Proxy, we don't exercise this function
    if (!config.proxy.enabled) {
        cb(null, barrel);
        return;
    }

    var logger = require('./loggers').getLogger();
    logger.debug('verifying permission, authProxy enabled' +
    ', incoming permissions: '+ barrel.transactionPayload.permissions);

    //Headers should have been provided by the Auth Proxy.  If not,
    //then there is something wrong.
    //barrel.username = btools.getUserNameHeader(barrel.req);
    if (!barrel.username) {
        logger.error('missing username from tx payload');
        cb(new errors.AuthorizationError('invalidUsername'), barrel);
        return;
    }

    // If a permission is provided, check that the permission is one of the
    // allowed permissions forwarded as part of the transaction payload. Service
    // permissions are no longer supported
    if (barrel.permission) {
        if (!btools.simplePermissionCheck(barrel.permission, barrel.transactionPayload.permissions)) {
            cb(new errors.AuthorizationError('permissionNotGranted'), barrel);
            return;
        }
    }

    //Get the account and realm.  This should already have been verified
    //by the Auth Proxy and we just put them in the barrel for convenience.
    barrel.accountId = db.getSafeDatabaseName(barrel.req.params.accountId);
    barrel.realmId = barrel.req.params.realmId;

    cb(null, barrel);
}
module.exports.verifyTransactionPermission = verifyTransactionPermission;

function verifyAccount(barrel, cb) {

    barrel.accountId = db.getSafeDatabaseName(barrel.req.params.accountId);
    //If we are using the Auth Proxy, we don't exercise this function
    if (config.proxy.enabled) {
        cb(null, barrel);
        return;
    }

    var logger = require('./loggers').getLogger();
    logger.debug('verifying account');

    if (!barrel.req.params.accountId) {
        cb(new errors.BadRequestError('requestMissingAccount'), barrel);
        return;
    }
    cb(null, barrel);
}
module.exports.verifyAccount = verifyAccount;


function verifyRealm(barrel, cb) {

    barrel.realmId = barrel.req.params.realmId;
    //If we are using the Auth Proxy, we don't exercise this function
    if (config.proxy.enabled) {
        cb(null, barrel);
        return;
    }

    var logger = require('./loggers').getLogger();
    logger.debug('verifying realm');

    if (!barrel.realmId) {
        cb(new errors.BadRequestError('requestMissingRealm'), barrel);
        return;
    }

    cb(null, barrel);
}
module.exports.verifyRealm = verifyRealm;


function verifyAccessToken(barrel, cb) {

    barrel.accessToken = btools.getAccessToken(barrel.req);

    var logger = require('./loggers').getLogger();
    logger.debug('verifying access_token');

    if (!barrel.accessToken) {
        cb(new errors.BadRequestError('requestMissingAccessToken'), barrel);
        return;
    }

    cb(null, barrel);
}
module.exports.verifyAccessToken = verifyAccessToken;

function verifyOrigin(barrel, cb) {

    var logger = require('./loggers').getLogger();

    var origin;
    try {
        origin = btools.getOrigin(barrel.req);
    } catch (e) {
        logger.debug('problem determining origin', e);
        return cb(e, barrel);
    }

    barrel.origin = origin;
    cb(null, barrel);
}
module.exports.verifyOrigin = verifyOrigin;



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
        return cb(e, barrel);
    }
    var op = 'and';
    if (barrel.op) {
        op = barrel.op;
    }

    //Make sure the access_token has permission to do this action.
    authCall.completeCheckPermissions(barrel.accountId, barrel.realmId, origin, barrel.accessToken, barrel.permission, op, function (err, results) {

        if (err) {
            logger.debug('permission check failed', err);
            cb(err, barrel);
            return;
        }

        logger.debug('permission check results', results);

        barrel.origin = origin;
        barrel.permissionCheck = typeof results === 'string' ? JSON.parse(results) : results;
        cb(null, barrel);
    });
}
module.exports.checkPermission = checkPermission;

/**
 * Fetch the Permissions object from the transaction record keyed by the transactionId that is stored in the request header
 * 'com.icesoft.services.transaction.id'
 */
function getTransactionData(barrel, cb) {
    var logger = require('./loggers').getLogger();
    var txCode = scopes.getTransactionId(barrel);
    if (!txCode) {
        logger.error('TransactionCode header is not defined in the request');
        return cb(new errors.ServerError('generalError'), barrel);
    }
    scopes.getTransactionAttribute(barrel, 'txPayload')
        .then(
        function (getResult) {
            logger.debug('Retrieved payload from tx scope, txCode: ', txCode, 'Payload:', JSON.stringify(getResult));
            barrel.transactionData = getResult;
            barrel.transactionPayload = getResult;
            barrel.username = getResult.username;
            barrel.access_token = getResult.access_token;
            barrel.permissions = getResult.permissions;
            barrel.username = getResult.username;
            barrel.roles = getResult.roles;
            cb(null, barrel);
        }
    ).catch(
        function (err) {
            logger.error('Exception getting Attribute: txPayload, tx: ', txCode, err);
            return cb(err, barrel);
        }
    );
}
module.exports.getTransactionData = getTransactionData;

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
            cb(new errors.ServerDetailsError('databaseError', err), barrel);
            return;
        }

        barrel.collection = coll;

        //Ensure that the appropriate index is set for the collection as
        //they are mandatory for geospatial queries.
        if (barrel.collectionIndex) {
            coll.ensureIndex(barrel.collectionIndex, function (indexError, indexName) {
                if (indexError) {
                    logger.error('could not create index: ' + indexError);
                    cb(new errors.ServerDetailsError('databaseError', indexError), barrel);
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

function getCollections(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('getting database collection: ' + barrel.accountId + ' -> ' + barrel.realmId + '.' + barrel.collectionName);

    db.getRealmCollections(barrel.accountId,barrel.realmId,function(err,items){
        if(err){
            logger.error('could not get collections: ' + err);
            cb(new errors.ServerDetailsError('collectionsError', err), barrel);
            return;
        }
        barrel.collections = items;
        cb(null,barrel);
    });
}
module.exports.getCollections = getCollections;

function validatePayload(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('validating payload');

    var payload = btools.getBodyAsJSON(barrel.req);

    logger.debug('payload: ' + JSON.stringify(payload));

    if (!payload) {
        return cb(new errors.BadRequestDetailsError('requestMissingOrInvalidPayload', 'no payload in body of request'), barrel);
    }

    if (payload instanceof Array) {
        return cb(new errors.BadRequestDetailsError('requestMissingOrInvalidPayload', 'payload cannot be an array'), barrel);
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
                    cb(new errors.ServerDetailsError('serviceRequestError', err), barrel);
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
                return cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage), barrel);
            }
        }
    }

    logger.debug('results parameter: ' + JSON.stringify(barrel.resultsScope));

    return cb(null, barrel);
}
module.exports.processResultsParameter = processResultsParameter;

/**
 * @deprecate should change to processQueryResourceParameter when switching to
 * resource parameters
 */
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
                return cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage), barrel);
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


/**
 * This is the new version that prepends _data. to the query field names for proper namespacing.
 * This version must be used when using resource permissions
 */
function processQueryResourceParameter(barrel, cb) {

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
                barrel.searchQuery = prefixPhrases(theQuery);
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'query',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                return cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage), barrel);
            }
        }
    }

    if (barrel.req.params.resourceId) {
        barrel.searchQuery._id = barrel.req.params.resourceId;
    }

    logger.debug('query parameter: ' + JSON.stringify(barrel.searchQuery));
    return cb(null, barrel);
}
module.exports.processQueryResourceParameter = processQueryResourceParameter;

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
                barrel.fieldsFilter = prefixPhrases(theFields);

            } catch (parseError) {
                var errorMessage = {
                    parameter: 'fields',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage), barrel);
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
                barrel.queryOptions = prefixOptions(theOptions);
            } catch (parseError) {
                var errorMessage = {
                    parameter: 'options',
                    message: 'could not parse',
                    error: parseError
                };
                logger.warn(JSON.stringify(errorMessage));
                cb(new errors.BadRequestDetailsError('requestBadParameter', errorMessage), barrel);
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
            cb(new errors.BadRequestDetailsError('requestBadParameter', 'invalid payload'), barrel);
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
                cb(new errors.BadRequestDetailsError('requestBadParameter', err), barrel);
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
                cb(new errors.BadRequestDetailsError('requestBadParameter', err), barrel);
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

    // Only generate new Id's on POST. Put's now are for updates only. If there is no id,
    // the PUT can affect multiple resources that don't require ID's
    if (!officialResourceId && barrel.req.method === 'POST') {
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
            cb(new errors.AuthorizationError('no service token', err), barrel);
            return;
        }

        barrel.serviceToken = token;

        cb(null, barrel);
    });

}
module.exports.retrieveServiceTokenAndPermissions = retrieveServiceTokenAndPermissions;

/**
 * @deprecate Should be replaced with the records and structure to use findResourceViaResourceQuery
 */
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
                cb(new errors.ServerDetailsError('databaseError', err), barrel);
                return;
            }

            if (!results || results.length === 0) {

                if (barrel.searchQuery && barrel.searchQuery._id) {
                    cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
                    return;
                }
            }

            barrel.results = !results ? {} : results;
            cb(null, barrel);
        });
    } else {
        barrel.collection.findOne(barrel.searchQuery, barrel.fieldsFilter, barrel.queryOptions, function (err, results) {

            if (err) {
                cb(new errors.ServerDetailsError('databaseError', err), barrel);
                return;
            }

            if (!results || results.length === 0) {

                if (barrel.searchQuery && barrel.searchQuery._id) {
                    cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
                    return;
                }
            }
            barrel.results = !results ? {} : results;
            cb(null, barrel);
        });
    }
}
module.exports.findResource = findResource;

/**
 * The new findResource function. This function uses the barrel.query parameter which should have
 * been assembled by assembleResourceQuery.
 */
function findResourceViaResourceQuery(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.info('finding resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.query) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope, barrel.meta
    );

    if (barrel.resultsScope === 'all') {
        barrel.collection.find(barrel.query, barrel.fieldsFilter, barrel.queryOptions).toArray(function (err, results) {

            if (err) {
                logger.error('Exception during findResource: ' + JSON.stringify(err), barrel.meta);
                cb(new errors.ServerDetailsError('databaseError', err), barrel);
                return;
            }
            logger.debug('resource Query finds: ' + results.length + ' resources');
            if (!results || results.length === 0) {
                if (barrel.query && barrel.searchQuery._id) {
                    cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
                    return;
                }
            }
            // This might need adjustment. Fields parameter means the _data block will always be there, I think
            if (results) {
                var newResults = [];
                for (var v = 0; v < results.length; v++) {
                    var rc = results[v]._data;
                    rc['_id'] = results[v]._id;
                    newResults.push(rc);
                }
            }
            barrel.results = !newResults ? {} : newResults;
            cb(null, barrel);
        });
    } else {
        barrel.collection.find(barrel.query, barrel.fieldsFilter, barrel.queryOptions).limit(1).toArray( function (err, results) {

            if (err) {
                cb(new errors.ServerDetailsError('databaseError', err), barrel);
                return;
            }

            if (!results || results.length === 0) {
                if (barrel.searchQuery && barrel.searchQuery._id) {
                    cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
                    return;
                }
            }
            if (results) {
                var newResults = [];
                for (var v = 0; v < results.length; v++) {
                    var rc = results[v]._data;
                    rc['_id'] = results[v]._id;
                    newResults.push(rc);
                }
            }
            barrel.results = !newResults ? {} : newResults;
            cb(null, barrel);
        });
    }
}
module.exports.findResourceViaResourceQuery = findResourceViaResourceQuery;

/**
 * Find all resources in a collection that the user has rights or roles for.
 */
function findAllResources(barrel, cb) {

    var logger = require('./loggers').getLogger();

    var rolePhraseBlock = [];

    for (var rn in barrel.roles) {
        var roleName = metaRolePrefix + barrel.roles[rn];
        var roleClause = {};
        roleClause[roleName] = barrel.operation;
        rolePhraseBlock.push(roleClause);
    }

    var topLevelOrClauses = [
        {
            '_permissions.owner': barrel.username,
            '_permissions.rights.owner': barrel.operation
        },
        {
            '_permissions.rights.realm': barrel.operation
        }
    ];
    // Add the role phrases as an $or clause only if there are some roles
    if (rolePhraseBlock.length > 0) {
        topLevelOrClauses.push( { $or: rolePhraseBlock} );
    }

    barrel.query  = {
        $or: topLevelOrClauses, //resource permission query
        $and:[{}] //user query
    };

    barrel.collection.find(barrel.query, {}, {}).toArray(function (err, results) {
        console.log('Inside find');
        if (err) {
            logger.error('Exception during findAllResources: ' + JSON.stringify(err), barrel.meta);
            cb(new errors.ServerDetailsError('databaseError', err), barrel);
            return;
        }
        logger.debug('resource Query finds: ' + results.length + ' resources');
        if (!results || results.length === 0) {
            if (barrel.query && barrel.searchQuery._id) {
                barrel.results = [];
                cb(null, barrel);
            }
        }
        // This might need adjustment. Fields parameter means the _data block will always be there, I think
        if (results) {
            var newResults = [];
            for (var v = 0; v < results.length; v++) {
                var rc = results[v]._data;
                rc['_id'] = results[v]._id;
                newResults.push(rc);
            }
        }
        barrel.results = !newResults ? {} : newResults;
        cb(null, barrel);
    });

}
module.exports.findAllResources = findAllResources;

function findResourceById(barrel, cb) {
    var logger = require('./loggers').getLogger();
    barrel.searchQuery = {_id: barrel.req.params.resourceId};
    barrel.resultsScope = 'one';
    logger.debug('finding resource by id', barrel.searchQuery);
    findResource(barrel, cb);
}
module.exports.findResourceById = findResourceById;


/**
 * @deprecate Should be replaced with the resource permission based version
 */
function removeResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('removing resource(s)');

    barrel.collection.remove(barrel.searchQuery, {w: 1}, function (err, numberOfDocs) {

        if (err) {
            cb(new errors.ServerDetailsError('databaseError', err), barrel);
            return;
        }

        //Only complain if trying to delete a specific resource
        if (numberOfDocs === 0 && barrel.searchQuery._id) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
            return;
        }

        barrel.results = numberOfDocs;
        cb(null, barrel);
    });

}
module.exports.removeResource = removeResource;

/**
 * Remove all resources in a collection that the user has rights for.
 */
function removeAllResources(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.info('removing all resources');

    var rolePhraseBlock = [];

    for (var rn in barrel.roles) {
        var roleName = metaRolePrefix + barrel.roles[rn];
        var roleClause = {};
        roleClause[roleName] = barrel.operation;
        rolePhraseBlock.push(roleClause);
    }

    var topLevelOrClauses = [
        {
            '_permissions.owner': barrel.username,
            '_permissions.rights.owner': barrel.operation
        },
        {
            '_permissions.rights.realm': barrel.operation
        }
    ];
    // Add the role phrases as an $or clause only if there are some roles
    if (rolePhraseBlock.length > 0) {
        topLevelOrClauses.push( { $or: rolePhraseBlock} );
    }

    barrel.query  = {
        $or: topLevelOrClauses, //resource permission query
        $and:[{}] //user query
    };

    barrel.collection.remove(barrel.query, {w: 1}, function (err, writeOpResult) {

        if (err) {
            return cb(err, barrel);
        }
        //Only complain if trying to delete a specific resource
        if (writeOpResult.result.n === 0 && barrel.searchQuery._id) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.query)), barrel);
            return;
        }
        barrel.results = writeOpResult.result.n;
        cb(null, barrel);
    });
}
module.exports.removeAllResources = removeAllResources;

/**
 * Remove resource. This is the version that should be used by applications with resource based
 * permissions in the records
 */
function removeResourceViaResourceQuery(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.info('removing resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.query), barrel.meta
    );

    barrel.collection.remove(barrel.query, {w: 1}, function (err, writeOpResult) {

        if (err) {
            return cb(err, barrel);
        }
        //Only complain if trying to delete a specific resource
        if (writeOpResult.result.n === 0 && barrel.searchQuery._id) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.query)), barrel);
            return;
        }
        barrel.results = writeOpResult.result.n;
        cb(null, barrel);
    });
}
module.exports.removeResourceViaResourceQuery = removeResourceViaResourceQuery;


function removeResourceById(barrel, cb) {
    var logger = require('./loggers').getLogger();
    barrel.searchQuery = {_id: barrel.req.params.resourceId};
    logger.debug('removing resource by id', barrel.searchQuery);
    removeResource(barrel, cb);
}
module.exports.removeResourceById = removeResourceById;

/**
 * @deprecated. Should use insertStructuredResource
 */
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
            return cb(err, barrel);
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.insertResource = insertResource;

/**
 * New version of insertResource that structures the document as follows:
 * This approach allows the _permissions to be excluded from the return object, and
 * allows the document to be replaced without rewriting the entire document via $set
 *
 * resource = {
 *   _id: x, The resource id as before
 *   _data: The entire original document
 *   _permissions: the resource permissions block
 * }
 */
function insertStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (barrel.validatedResourceId) {
        barrel.validatedResource._id = barrel.validatedResourceId;
    }

    logger.debug('inserting structured resource: ' +
        '\n  ' + JSON.stringify(barrel.validatedResource)
    );
    var newRecord  = {
        _id: barrel.validatedResource._id,
        _data : barrel.validatedResource,
        _permissions: barrel.resourceMetadata
    };
    // The ownername can come from the parsed record, or be the username by default
    if (barrel.parsedOwner) {
        newRecord._permissions.owner = barrel.parsedOwner;
    } else {
        newRecord._permissions.owner = barrel.username;
    }
    delete newRecord._data._id;
    barrel.collection.insert(newRecord, {w: 1}, function (err, doc) {

        if (err) {
            return cb(err, barrel);
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.insertStructuredResource = insertStructuredResource;


/**
 * @deprecated Should use saveStructuredResource instead
 */
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
            return cb(err, barrel);
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

/**
 * New version of saveResource that saves the original document in a new structured format with the
 * following format:
 *
 * resource = {
 *   _id: x, The resource id as before
 *   _data: The entire original document
 *   _permissions: the resource permissions block
 * }
 */
function saveStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (barrel.validatedResourceId) {
        barrel.validatedResource._id = barrel.validatedResourceId;
    }

    logger.info('saving resource: ' +
        '\n  ' + JSON.stringify(barrel.validatedResource), barrel.meta
    );

    var newRecord  = { _id: barrel.validatedResource._id,
                       _data : barrel.validatedResource,
                       _permissions: barrel.resourceMetadata
    };
    delete newRecord._data._id;

    barrel.collection.save(newRecord, {w: 1}, function (err, result) {

        if (err) {
            logger.error('could not save resource' + JSON.stringify(err), barrel.meta);
            return cb(err, barrel);
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
module.exports.saveStructuredResource = saveStructuredResource;


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

    // Update can only update
    barrel.queryOptions.upsert = false;

    logger.debug('updating resource with: ' +
        '\n  res     = ' + JSON.stringify(barrel.validatedResource) +
        '\n  query   = ' + JSON.stringify(barrel.searchQuery) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.update(barrel.searchQuery, barrel.validatedResource, barrel.queryOptions, function (err, numberOfDocs) {

        if (err) {
            return cb(err, barrel);
        }

        if (!numberOfDocs || numberOfDocs.length === 0) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
            return;
        }

        barrel.results = numberOfDocs;
        cb(null, barrel);

    });
}
module.exports.updateResource = updateResource;


/**
 * New version of updateResource. This function sets the _data portion of the structured
 * resource with the contents of the update. It does not allow modification of the
 * _permissions block
 */
function updateStructuredResource(barrel, cb) {

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

    // Update can only update
    barrel.queryOptions.upsert = false;

    logger.debug('updating resource with: ' +
        '\n  res     = ' + JSON.stringify(barrel.validatedResource) +
        '\n  query   = ' + JSON.stringify(barrel.query) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    delete barrel.validatedResource._id;
    barrel.collection.update(barrel.query,
        {
            $set: {"_data": barrel.validatedResource}
        }, barrel.queryOptions, function (err, numberOfDocs) {
            if (err) {
                logger.error('Error updating _data: ' + JSON.stringify(err), barrel.meta);
                return cb(err, barrel);
            }

            logger.debug('Number of updated documents: ' + numberOfDocs.result.nModified);
            if (numberOfDocs.result.nModified === 0) {
                return cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
            }
            barrel.results = numberOfDocs;
            cb(null, barrel);

    });
}
module.exports.updateStructuredResource = updateStructuredResource;

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
            return cb(err, barrel);
        }

        if (!results || results.length === 0) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.aggregation)), barrel);
            return;
        }

        barrel.results = results;
        cb(null, barrel);

    });
}
module.exports.aggregate = aggregate;

/**
 * The purpose of this function is to tailor a query string for database blobs based on the permission
 * that is used to find them. The query is assembled via:
 * ONE OF [
 *   { operator is owner of resource AND owner of resource has permission for OP } OR
 *   { operator is in realm AND realm operators have permission for OP }
 * ] OR [
 *   operator exists in ROLE AND ROLE has permission for OP
 * ]
 * PLUS (if present) {
 *   resourceId = barrel.resourceId
 * }
 * @param barrel.operation one of 'r', 'u', 'd', 'x', 'mu', 'pr', 'pu'
 * @param barrel.req.roles has to come from the auth proxy in the roles header
 * @param barrel.resourceId if present, is incorporated in the query as a concrete term
 */
function assembleResourceQuery(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (!barrel.operation) {
        logger.error('Cannot assemble resource query without operation ');
        return cb(new errors.ServerError('unsupportedOperation'), barrel);
    }
    var rolePhraseBlock = [];

    for (var rn in barrel.roles) {
        var roleName = metaRolePrefix + barrel.roles[rn];
        var roleClause = {};
        roleClause[roleName] = barrel.operation;
        rolePhraseBlock.push(roleClause);
    }

    var topLevelOrClauses = [
        {
            '_permissions.owner': barrel.username,
            '_permissions.rights.owner': barrel.operation
        },
        {
            '_permissions.rights.realm': barrel.operation
        }
    ];
    // Add the role phrases as an $or clause only if there are some roles
    if (rolePhraseBlock.length > 0) {
        topLevelOrClauses.push( { $or: rolePhraseBlock} );
    }

    barrel.query = {
        $or: topLevelOrClauses, //resource permission query
        $and:[{}] //user query
    };

    // The count query allows us to determine the number of records the client 'could' access without
    // permission restrictions. If the count query returns 0, then we generate a 404 error.
    barrel.countQuery = {};

    // Add in all the previous query clauses in a block for 'and' ing with the
    // permissions clauses
    if (barrel.searchQuery) {
        for (var i in barrel.searchQuery) {
            barrel.countQuery[i] = barrel.searchQuery[i];
        }
    }
    barrel.query.$and[0] = barrel.countQuery;
    cb(null, barrel);
}
exports.assembleResourceQuery = assembleResourceQuery;

/**
 * Update a series of resources _permissions
 * The resource owner should be able to be
 */
function updatePermissionsResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('updating permissions with: ' +
        '\n  rights     = ' + JSON.stringify(barrel.rights) +
        '\n  count query   = ' + JSON.stringify(barrel.countQuery) +
        '\n  query  = ' + JSON.stringify(barrel.query)
    );

    if (barrel.rights) {
        var possibleRecordCount = 0;
        barrel.collection.count(barrel.countQuery, function (err, count) {
                if (err) {
                    logger.error('Exception performing count query: ' + JSON.stringify(err), barrel.meta);
                    return cb(err, barrel);
                }
                logger.debug('permissions update count: ' + count);
                if (count === 0) {
                    return cb(new errors.NotFoundError ('resourceNotFound'), barrel);
                }
                possibleRecordCount = count;
                var updateClause = {"_permissions.rights": barrel.resourceMetadata.rights};
            // This must only come from the processed block, and not be simply the owner of the
            // access_token.
                if (barrel.parsedOwner) {
                    updateClause['_permissions.owner'] = barrel.parsedOwner;
                }
            var o = {w:1};
            o.multi = true;
                barrel.collection.updateMany(barrel.query,
                    {
                        $set: updateClause
                    },o,
                    function (err, doc) {
                        if (err) {
                            logger.error('Error updating resource metadata: ' + JSON.stringify(err), barrel.meta);
                            return cb(err, barrel);
                        }

                        if (doc.result.n != possibleRecordCount && possibleRecordCount === 1) {
                            logger.debug('Mismatch in single permission update, actually updated: ' + doc.result.n);
                            return cb(new errors.PermissionError('permissionNotGranted'), barrel);
                        } else if (doc.result.n != possibleRecordCount) {
                            logger.debug('Mismatch in multiple permission update, possible: ' + possibleRecordCount +
                                         ', actual: ' + doc.result.n);
                            cb(err, barrel);
                        } else {
                            cb(null, barrel);
                        }
                    });
            });

    } else {
        logger.warn ('update rights attempted with no rights object', barrel.meta);
        cb(null, barrel);
    }
}
exports.updatePermissionsResource = updatePermissionsResource;


/**
 * Fetch a directory of all blobs with metadata matching a given username and realm (in barrel)
 */
function getPermissionsDirectory(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('updating resource with: ' +
        '\n  permissions query   = ' + JSON.stringify(barrel.query) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.find(barrel.query, barrel.fieldsFilter, barrel.queryOptions).toArray(function (err, files) {
        if (err) {
            logger.error('getRightsDirectory encounters error finding records: ' + JSON.stringify(err), barrel.meta);
            return cb(err, null);
        }
        var returnVal = new Array();
        logger.debug('getRightsDirectory found: ' + files.length + ' records, ', barrel.meta);
        if (files) {
            for (var i = 0; i < files.length; i++) {
                var resourceMetadata = {
                    _id: files[i]._id,
                    owner: files[i]._permissions.owner,
                    rights: files[i]._permissions.rights
                };
                returnVal [i] = resourceMetadata;
            }
        }
        barrel.blobs = returnVal;
        barrel.blob = returnVal[0];
        cb(null, barrel);
    });
}
exports.getPermissionsDirectory = getPermissionsDirectory;

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
    } else if (port && port.indexOf(':') == 0) {
        resourceLocation += port;
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

// NTFY-338. Resource locations must be dynamic.
function setResourceLocation(barrel, cb) {

    var proxyHost = btools.getHost(barrel.req);
    var logger = require('./loggers').getLogger();
    logger.debug('Proxy Host value: ' + proxyHost);

    barrel.resourceLocation = calculateResourceURL(
        barrel.req.protocol,
        proxyHost,
        config.service.resourcePort,
        barrel.req.path,
        barrel.validatedResourceId
    );
    cb(null, barrel);

}
module.exports.setResourceLocation = setResourceLocation;

/**
 * This function should be used by clients to create a new resourceMetadata object.
 * It starts with the default resourceMetadata block from an applications
 * config module. It tries to fetch an owner value from the incoming request
 * and stores that in barrel.parsedOwner. If not found, there is always barrel.username.
 * The value to be used depends on the calling function (insert vs update)
 * It then fetches a 'rights' metadata object
 * (if available) from the request and inserts it into the overall resourceMetadata property.
 */
var processResourceMetadata = function(barrel, cb) {

    var logger = require('./loggers').getLogger();

    barrel.resourceMetadata = {};
    barrel.resourceMetadata = JSON.parse(JSON.stringify(config.service.defaultPermissionsMetadata));

    var err;
    if (barrel.req.body.owner) {
        err = processOwner(barrel);
        if (err) {
            logger.error ('Error parsing ownername field: ' + JSON.stringify(err), barrel.meta);
            return cb(err, barrel);
        }
    }
    if (barrel.req.body.rights) {
        err = processRights(barrel);
        if (err) {
            return cb(err, barrel);
        }
        barrel.resourceMetadata.rights = barrel.rights;
    }
    cb(null, barrel);
};
exports.processResourceMetadata = processResourceMetadata;

/**
 * Extract the 'rights' field from the request and validate it, and try to parse the validated
 * string. This is useful when editing the rights property of a resource's resourceMetadata field, since
 * editing functions should not edit the larger resourceMetadata structure.
 *
 * Return the rights metadata in a barrel.rights
 * Clients of this method should have established the barrel.meta logging helper structure
 */
var processRights = function(barrel) {

    var logger = require('./loggers').getLogger();
    var rights = btools.getRights(barrel.req);
    if (rights) {
        var err = validation.validateRightsJSON(rights);
        if (err) {
            return err;
        }

        var checkString = JSON.stringify(rights);
        // Check for the existence, somewhere, of permissions update. If it doesn't
        // exist, then force it in somewhere. Otherwise the resource can get orphaned
        var spos = checkString.indexOf('pu');
        if (spos == -1) {
            if (rights.owner) {
                rights.owner.push('pu');
            } else {
                rights.owner = ['pu'];
            }
        }
        // Create a clean object to eliminate the risk of unwanted cruft
        barrel.rights = {};
        barrel.rights.owner = rights.owner;
        barrel.rights.realm = rights.realm;
        barrel.rights.roles = rights.roles;
    } else {
        logger.debug('NO rights in request', barrel.meta);
    }
    return;
};
exports.processRights = processRights;

/**
 * Extract and validate the 'owner' field from the request and validate it,
 *
 */
var processOwner = function(barrel) {

    var logger = require('./loggers').getLogger();
    var owner = btools.getOwner(barrel.req);
    if (owner) {
        if (!validation.usernameValidator(owner)) {
            return new errors.BadRequestError('invalidUsername');
        } else {
            barrel.parsedOwner = owner;
        }
    }
    return;
};
exports.processOwner = processOwner;

/**
 * For user input data, we wish to hide the fact that the user data is kept in a '_data.' property in the record.
 * When user query and fields parameters are provided, we need to preface each clause with the '_data.' prefix
 */
var prefixPhrases = function(phraseBlock) {
    var prefixPhrase = function (phrase) {
        us.each(phrase,function (value, key, list) {
            if (us.isObject(value)) {
                prefixPhrase(value);
            }
            //prefix when...
            if (us.isString(key) && //...we have a named key (obj prop not array index)
                key.indexOf('$') == -1 && //...that is not a query operator ($and, $ne, etc..)
                key != '_id') { //...and not '_id' (since _id isn't nested)
                //replace old key with new one
                list[dataBinPrefix+key] = value;
                delete list[key];
            }
        });
    };
    prefixPhrase(phraseBlock);
    return phraseBlock;
};

/**
 * For user input data, we wish to hide the fact that the user data is kept in a '_data.' property in the record.
 * When a user option parameter is provided, we need to preface each clause with the '_data.' prefix
 */
var prefixOptions = function(optionsBlock) {
    var prefixOption = function (phrase,forcePrefix) {
        us.each(phrase,function (value, key, list) {
            if (us.isObject(value)) {
                //if the object is sort option then we want to make sure we prefix
                //it's properties, even if the field names are 'limit' or 'sort'
                prefixOption(value,key=='sort');
            }
            //prefix when...
            if (us.isString(key) && //...we have a named key (obj prop not array index)
                key != '_id' && //...that is not '_id' (since _id isn't nested)
                (forcePrefix || (key != 'limit' && key != 'sort'))) { //...and not 'sort' or 'limit' options
                //replace old key with new one
                list[dataBinPrefix+key] = value;
                delete list[key];
            }
        });
    };
    prefixOption(optionsBlock,false);
    return optionsBlock;
};
