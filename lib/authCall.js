var config = require('./config');
var httpClient = require('request');
var errors = require('./errors');
var query = require('querystring');
var uuid = require('uuid');
var async = require('async');
var connMgr = require('./db');
var security = require('./security');

var btools = require('./tools');
var httpAgent = require('superagent');


/**
 * Convenience signature for performing default original permission check with 'and' logic
 * for all permissions
 *
 * @param account The Users account name
 * @param realm the Users realm
 * @param origin The domain name of the user. Should be from the origin or referer header
 * @param accessToken The user in questions access_token
 * @param permissions A string containing the required permissions. eg.
 *        'bridgeit.auth.viewUser bridgeit.auth.deleteUser'
 */
function checkPermissions(account, realm, origin, accessToken, permissions, cb) {
    completeCheckPermissions(account, realm, origin, accessToken, permissions, 'and', cb);
}
module.exports.checkPermissions = checkPermissions;


/**
 * Check to see if a User identified by access_token has permissions for an operation.
 * Given the identifying arguments, this function makes a network request to the auth
 * server and performs a callback with the results of the check. This function performs
 * a check on the permission block. If the permission check fails, the 'err' object will
 * be filled in, otherwise it maybe assumed the permission check has passed. The 'json result'
 * callback parameter will contain the original message from the server but this shouldn't
 * be used for checking the result
 *
 * @param account The Users account name
 * @param realm the Users realm
 * @param origin The domain name of the user. Should be from the origin or referer header
 * @param accessToken The user in questions access_token
 * @param permissions A string containing the required permissions. eg.
 *        'bridgeit.auth.viewUser bridgeit.auth.deleteUser'
 * @param op The logical operation applied ot the permissions. Valid options are:
 *        'and' (passes if all permissions pass) or 'or' (passes if any permission passes)
 * @param cb A callback function of the form callback(err, json result)
 */
function completeCheckPermissions(account, realm, origin, accessToken, permissions, op, cb) {

    //In order to have modules respect the logging configuration supplied by the service, we
    //need to get the logger in a 'lazy' fashion.  If we get it during initialization, then
    //the logger instance only has the default configuration.
    var logger = require('./loggers').getLogger();

    //Sometimes you may want to test your service without having to worry about having valid
    //entries in the authorization database.  Setting this configuration parameter to 'false'
    //will tell this method to 'automatically pass' the permission check.
    if (!config.auth.enabled) {
        logger.warn('[config.auth.enabled = ' + config.auth.enabled + ']',
            '** Permission checking has been disabled for development. It should be re-enabled in a production environment. **');
        cb(null, {message: 'permission(s) granted', username: 'developmentUser'});
        return;
    }

    logger.debug('checkPermissions:' +
    '\n  account     : ' + account +
    '\n  realm       : ' + realm +
    '\n  origin      : ' + origin +
    '\n  access_token: ' + accessToken +
    '\n  permissions : ' + permissions);

    var errorMessage;
    if (!account) {
        logger.error('valid account required');
        cb(new errors.BadRequestError('missingAccount'));
        return;
    }

    if (!realm) {
        logger.error('valid realm required');
        cb(new errors.BadRequestError('missingRealm'));
        return;
    }

    if (!accessToken) {
        logger.error('valid access_token required');
        cb(new errors.BadRequestError('missingToken'));
        return;
    }

    if (!permissions) {
        logger.error('permissions required');
        cb(new errors.BadRequestError('missingPermissions'));
        return;
    }

    var permissionsArray = btools.santizePermissions(permissions);

    if (!permissionsArray) {
        logger.error('invalid permissions format', permissions);
        cb(new errors.BadRequestError('invalidPermissionsFormat'));
        return;
    }

    var headers = {
        'origin': origin,
        'Content-type': 'application/json'
    };

    var body = {
        strategy: 'direct',
        access_token: accessToken,
        permissions: permissionsArray,
        op: op
    };
    var options = {
        uri: config.auth.url + '/' + account + '/realms/' + realm + '/permission',
        body: JSON.stringify(body),
        headers: headers
    };

    logger.debug('options: ', JSON.stringify(options));

    var d1 = new Date();
    httpClient.post(options, function (err, response) {

        if (err) {
            logger.error('problem with permissions request', err);
            return cb(err, null);
        }

        if (response.statusCode < 200 || response.statusCode > 299) {
            var result;
            // Currently there is a difference between passport failures vs other failures
            // that we catch and send via the standard error handling mechanism.
            try {
                result = btools.getBodyAsJSON(response);

                logger.warn('problem getting service token (our stuff): ' + result.status, result.message);
                var err = new Error();
                err.status = result.status;
                err.code = result.code;
                err.message = result.message;
                return cb(err, null);

            } catch (e) {
                logger.warn('Exception parsing token response: ' + response.statusCode + ', body: ' + response.body);
                logger.warn('Can occur on response from passport, or potential other sources. Content Follows: ');
                logger.warn(response.body);
                return cb(new errors.OperationError(response.statusCode, response.body), null);
            }
        } else {
            cb(null, response.body);
        }
    });
}
module.exports.completeCheckPermissions = completeCheckPermissions;

//This is the amount of time in milliseconds that we subtract from the
//expiry time when calculating whether to get a new token.  This allows
//some breathing from to avoid trying to use a token that is about to
//expire. Defaulting to 10 seconds for now.
var expiryBuffer = 10000;

//Storage cache for all active tokens.
var tokenCache = {};

//The realm that Auth uses for inter-service related calls.
var realm = 'bridgeit.services';

//Gets a token that allows one service to communicate with another.  This type
//of inter-service authentication is necessary when the original user's request
//might not have the required authorization.  This implementation will cache
//active tokens and will only request a new one if there isn't one cached or
//the cached copy is about to expire.
function getServiceToken(credentials, cb) {

    var logger = require('./loggers').getLogger();

    //Sometimes you may want to test your service without having to worry about making
    //valid calls to the authorization service.  In this case, you'll just get back
    //a randomly generated token that you can use to continue testing with.
    if (!config.auth.enabled) {
        logger.warn('[config.auth.enabled = ' + config.auth.enabled + ']',
            '** Service Tokens have been disabled for development. It should be re-enabled in a production environment. **');
        cb(null, uuid.v4());
        return;
    }

    if (!credentials || !credentials.username) {
        logger.warn('missing or incomplete credentials');
        return cb({"error": "missing or incomplete credentials"}, null);
    }

    //Try and get a cached token keyed on the username (e.g. bridgeit.locate)
    var cachedToken = tokenCache[credentials.username];

    if (cachedToken) {
        //Make sure it hasn't expired or is not about to expire imminently
        if (Date.now() < (cachedToken.expires_in - expiryBuffer)) {
            return cb(null, cachedToken.access_token);
        }
    }

    //If there isn't one cached or it has expired, request a new one and put it in the cache.
    requestServiceToken(credentials, function (err, tokenInfo) {

        if (err) {
            return cb(err, null);
        }

        //Parse the response and put it in the cache before returning the
        //actual access_token to the service requesting it.
        var parsedToken = JSON.parse(tokenInfo);

        //Shortening the expiry is just a way to simplify testing.  Not for production purposes.
//        parsedToken.expires_in = Date.now() + 30000;

        tokenCache[credentials.username] = parsedToken;
        return cb(null, parsedToken.access_token);
    });

}
module.exports.getServiceToken = getServiceToken;


/*
 * This handles the HTTP call to the Auth service to get the access_token.  The
 * credentials should contain a username and a password.  The callback will return
 * an error or an access_token.
 * credentials object contains username and password properties with salient details
 */

function requestServiceToken(credentials, cb) {

    var logger = require('./loggers').getLogger();

    var headers = {
        'Content-type': 'application/json',
        'Referer': config.notify.referrer
    };

    var queryParams = {
        strategy: 'query',
        username: credentials.username,
        password: credentials.password
    };

    var options = {
        uri: config.auth.url + '/bridgeit/realms/' + realm + '/token',
        method: 'GET',
        headers: headers,
        qs: queryParams
    };

    httpClient.get(options, function (err, response) {

        if (err) {
            logger.error('problem with service token request:', err);
            return cb(err, null);
        }

        if (response) {

            if (response.statusCode < 200 || response.statusCode > 299) {
                var result;
                // Currently there is a difference between passport failures vs other failures
                // that we catch and send via the standard error handling mechanism.
                try {
                    result = btools.getBodyAsJSON(response);
                    logger.warn('problem getting service token (our stuff):' + result.status, result.message);
                    return cb(new errors.PermissionError(result.message));
                } catch (e) {
                    logger.warn('Exception parsing token response: ' + response.statusCode + ', body: ' + response.body);
                    logger.warn('Can occur on response from passport, or potential other sources. Content Follows: ');
                    logger.warn(response.body);
                    return cb(new errors.OperationError(response.statusCode, response.body));
                }
            } else {
                cb(null, response.body);
            }
        }
    });
}


//A wrapper around the currently cached token along with the lastUpdated timestamp and
//an expiry buffer that can be used to figure out when we should request a fresh token.
//The token property itself, when populated, should contain the actual access_token as
//well as the expires_in value and the associated permissions:
//    token: {
//        access_token: xxx,
//        expires_in: xxx,
//        permissions: [ xxx, xxx, xxx, ... ]
//    }
var serviceTokenWrapper = {
    lastUpdated: 0,
    expiryBuffer: 60000,
    token: {}
};

/**
 * Gets a valid service token (either cached or a new one) and then uses that token to get the current set
 * of permissions.  While we could cache the permissions as well, it might lead to problems when they are
 * updated as the cached token would have to expire before we requested the permissions again, which could
 * lead to odd behaviour and security issues.  So, for now, we always request fresh permissions.
 *
 * @param {Object} params
 * @param {String} params.account
 * @param {String} params.realm
 * @param {String} params.endpointId
 *
 * @returns A valid service record that contain the actual access_token as well as the expires_in value
 * and the associated permissions:
 *
 *     {
 *         access_token: xxx,
 *         expires_in: xxx,
 *         permissions: [ xxx, xxx, xxx, ... ]
 *     }
 *
 */
function retrieveServiceTokenAndPermissions(params, cb) {

    retrieveServiceToken(params, function (err, tokenRecord) {

        if (err) {
            cb(err);
            return;
        }

        params.access_token = tokenRecord.access_token;

        retrievePermissions(params, function (err, permissionRecord) {

            if (err) {
                cb(err);
                return;
            }

            //We set the permissions into the wrapper here but we
            //really don't cache them because we make a fresh request
            //for them each time.
            serviceTokenWrapper.token.permissions = permissionRecord.permissions;
            cb(null, serviceTokenWrapper.token);
        });
    });
}
module.exports.retrieveServiceTokenAndPermissions = retrieveServiceTokenAndPermissions;

/**
 * Get a valid service token.  This token allows an executable service endpoint (like a context or flow) to
 * run with privileges separate (and generally upgraded from) the privileges held by the initial agent making
 * the request.  The access_token is either retrieved from the cache (if it exists and is not or is not about
 * to expire), or retrieved from the Auth Service as required.
 *
 * @param {Object} params
 * @param {String} params.account
 * @param {String} params.realm
 * @param {String} params.endpointId
 *
 * @returns A valid service access_token for the executable context, flow, or other unique service endpoint.
 *
 */
function retrieveServiceToken(params, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('token wrapper:', serviceTokenWrapper);

    //If the token is not yet set, expired, or about to expire shortly, then get a new one.
    if (!serviceTokenWrapper.token.access_token || !serviceTokenWrapper.token.expires_in ||
        serviceTokenWrapper.lastUpdated + serviceTokenWrapper.token.expires_in + expiryBuffer < new Date().getTime()) {

        logger.debug('current token is invalid, expired, or about to expire, requesting a new token');
        getNewServiceToken(params, function (err, newToken) {
            if (err) {
                cb(err);
                return;
            }
            serviceTokenWrapper.token = newToken;
            serviceTokenWrapper.lastUpdated = new Date().getTime();
            logger.debug('caching new token', serviceTokenWrapper);
            cb(null, serviceTokenWrapper.token);
        });

    } else {
        logger.debug('current token is valid');
        cb(null, serviceTokenWrapper.token);
    }
}
module.exports.retrieveServiceToken = retrieveServiceToken;

/**
 * Gets the permissions associated with a valid service token.  By first getting the service token
 * (either cached or a new one) and then using that token to get the current set
 * of permissions.
 *
 * Note: While we could cache the permissions as well, it might lead to problems when they are
 * updated as the cached token would have to expire before we requested the permissions again, which could
 * lead to odd behaviour and security issues.  So, for now, we always request fresh permissions.
 *
 * @param {Object} params
 * @param {String} params.account
 * @param {String} params.realm
 * @param {String} params.endpointId
 * @param {String} params.access_token
 *
 * @returns All the associated permissions for the provided endpoint as an array of strings. A valid
 *          access_token is required.
 */
function retrievePermissions(params, cb) {

    var permissionsPath = '/authadmin/' + params.account + '/realms/' + params.realm + '/permissions';
    var permissionsURL = config.auth.scheme + '://' + config.auth.host + config.auth.port + permissionsPath;

    httpAgent
        .get(permissionsURL)
        .set('Authorization', 'Bearer ' + params.access_token)
        .query({username: params.endpointId})
        .end(function (err, response) {

            if (err) {
                cb(err, null);
                return;
            }

            if (!response) {
                cb(new errors.OperationError('no response for permissions'));
                return;
            }

            if (response.statusCode !== 200) {
                cb(new errors.OperationError('status code is not 200 - ' + response.statusCode));
                return;
            }

            var permissionRecord = btools.getBodyAsJSON(response);

            cb(null, permissionRecord);
        });
}
module.exports.retrievePermissions = retrievePermissions;

/**
 * Makes a request to the Auth Service to get a new service token for the specified endpoint.  It
 * uses Basic Digest authentication.  Currently the credentials are stored in a known location in
 * a specific database collection - [realm].credentials
 *
 * @param {Object} params
 * @param {String} params.account
 * @param {String} params.realm
 * @param {String} params.endpointId
 *
 * @returns A valid service access_token for the executable context, flow, or other unique service endpoint.
 *
 */
function getNewServiceToken(params, callback) {

    var logger = require('./loggers').getLogger();

    var tokenPath = '/auth/' + params.account + '/realms/' + params.realm + '/token' + '?strategy=digest';
    var tokenURL = config.auth.scheme + '://' + config.auth.host + config.auth.port + tokenPath;

    var endpointURI = config.auth.url + '/' + params.account + '/realms/' + params.realm + '/' + params.endpointId;

    var barrel = {
        account: params.account,
        realm: params.realm,
        tokenPath: tokenPath,
        tokenURL: tokenURL,
        endpointId: params.endpointId,
        endpointURI: endpointURI,
        collectionName: 'credentials'
    };

    async.waterfall([
        function (cb) {
            cb(null, barrel);
        },
        digestRequest,
        getCredentials,
        prepareDigest,
        digestResponse
    ], function (err, barrel) {

        if (err) {
            logger.error('could not get new service token', err);
            callback(err);
            return;
        }

        callback(null, barrel.serviceToken);
    });

}

/**
 * Sends the initial digest request which should result in a challenge response.
 *
 * @param {Object} barrel
 * @param {String} barrel.account
 * @param {String} barrel.realm
 *
 * @returns barrel If successful, sets barrel.digestChallenge.
 *
 */
function digestRequest(barrel, cb) {

    httpAgent
        .get(barrel.tokenURL)
        .type('application/json')
        .query({strategy: 'digest'})
        .end(function (err, response) {

            if (err) {
                cb(err, null);
                return;
            }

            if (!response) {
                cb(new errors.OperationError('no response to initial digest request to get service token'));
                return;
            }

            if (response.status !== 401) {
                cb(new errors.OperationError('status code is not 401 - ' + response.statusCode));
                return;
            }

            //If we got the appropriate challenge, we need to process our values and respond.
            var challengeDigestHeader = response.header['www-authenticate'];
            if (!challengeDigestHeader) {
                cb(new errors.OperationError('no digest header'));
                return;
            }

            barrel.digestChallenge = challengeDigestHeader;
            cb(null, barrel);
        });
}

/**
 * Get our the credentials for this endpoint so that we can use them to authenticate and
 * get a new service token.  The current strategy is just to retrieve them from a known
 * database collection.
 *
 * @param {Object} barrel
 * @param {String} barrel.account
 * @param {String} barrel.realm
 * @param {String} barrel.endpointId
 *
 * @returns barrel If successful, sets barrel.credentials.
 *
 */
function getCredentials(barrel, cb) {

    connMgr.getCollection(barrel.account, barrel.realm, barrel.collectionName, function (err, coll) {

        if (err) {
            cb(new errors.ServerError('problem getting credentials collection'));
            return;
        }

        var record = {
            ident: barrel.endpointId
        };

        coll.findOne(record, function (err, creds) {

            if (err || !creds) {
                cb(new errors.ServerError('problem finding credentials'));
                return;
            }

            barrel.credentials = creds;
            cb(null, barrel);
        });
    });
}

/**
 * Processes the digest challenge data and prepares the digest response.
 *
 * @param {Object} barrel
 * @param {String} barrel.account
 * @param {String} barrel.realm
 * @param {String} barrel.endpointId
 * @param {String} barrel.digestChallenge
 * @param {String} barrel.credentials
 *
 * @returns barrel If successful, sets barrel.responseDigest.
 *
 */
function prepareDigest(barrel, cb) {

    //var logger = require('./loggers').getLogger();

    var digestValues = parseDigestHeader(barrel.digestChallenge);

    var hashOne = security.md5(barrel.endpointId + ':' + digestValues.realm + ':' + barrel.credentials.pw);

    var hashTwo = security.md5('GET:' + barrel.tokenPath);

    var response = security.md5(hashOne + ":" + digestValues.nonce + ":" + hashTwo);

    barrel.responseDigest = 'Digest' +
    ' username=' + barrel.endpointId +
    ', realm=' + digestValues.realm +
    ', uri=' + barrel.tokenPath +
    ', response=' + response +
    ', nonce=' + digestValues.nonce;

    //logger.debug('Digest details',
    //    '\n  digest challenge values: ', digestValues,
    //    '\n  ha1: ', hashOne,
    //    '\n  ha2: ', hashTwo,
    //    '\n  final header:', barrel.responseDigest);

    cb(null, barrel);

}


/**
 * Processes the digest challenge and sends back a response.
 *
 * @param {Object} barrel
 * @param {String} barrel.account
 * @param {String} barrel.realm
 * @param {String} barrel.endpointId
 * @param {String} barrel.digestChallenge
 * @param {String} barrel.credentials
 *
 * @returns barrel If successful, sets barrel.serviceToken.
 *
 */
function digestResponse(barrel, cb) {

    httpAgent
        .get(barrel.tokenURL)
        .set('Authorization', barrel.responseDigest)
        .query({strategy: 'digest'})
        .end(function (err, response) {

            if (err) {
                cb(err, null);
                return;
            }

            if (!response) {
                cb(new errors.OperationError('no response for digest'));
                return;
            }

            if (response.statusCode !== 200) {
                cb(new errors.OperationError('status code is not 200 - ' + response.statusCode));
                return;
            }

            barrel.serviceToken = btools.getBodyAsJSON(response);

            cb(null, barrel);
        });

}

/**
 * Extract and parse the Authorization: Digest header values.
 * @param raw
 */
function parseDigestHeader(raw) {

    var temp = raw;
    if (temp.trim().indexOf('Digest') === 0) {
        temp = temp.slice('Digest'.length).trim();
    }
    if (temp.lastIndexOf(';') === (temp.length - 1)) {
        temp = temp.slice(0, temp.length - 1);
    }
    temp = temp.replace(/\"/g, '');

    var jsonString = '{';
    var parts = temp.split(',');
    for (var index = 0; index < parts.length; index++) {
        var keyVal = parts[index].split('=');
        jsonString = jsonString + '"' + keyVal[0].trim() + '":"' + keyVal[1].trim() + '"';
        if (index < (parts.length - 1)) {
            jsonString = jsonString + ',';
        }
    }
    jsonString = jsonString + '}';
    var parsed = JSON.parse(jsonString);
    return parsed;
}


