"use strict";
var config = require('./config.js');
var validator = require('validator');
var errors = require('./errors');
var urlParse = require('url');
var validation = require('./validation');
var scopes = require('./scopes');
var zlib = require('zlib');
var uuid = require('uuid');
var ld = require('lodash');
var Redis = require('ioredis');



function notAllowed(msg, req, res, next) {
    var result = {status: 'failure', message: msg};
    res.send(result);
}


function ping(msg, req, res, next) {
    var result = {status: 'ping', message: msg};
    res.send(result);
}


function preflight(msg, req, res, next) {
    res.send(204);
}

/**
 * Utility method for ensuring the payload is JSON
 * This method will throw a parse exception if the content isn't
 * really JSON. This can occur if trying to parse a response from
 * passport modules, whose responses may not be JSON encoded.
 *
 * @param req
 * @returns {*}
 */
function getBodyAsJSON(req) {

    if (!req) {
        return;
    }

    var rawData = req.body;

    if (!rawData) {
        return;
    }

    var type = typeof rawData;
    var data = rawData;
    if ("string" === type) {
        data = JSON.parse(rawData);
    }
    return data;
}


/**
 * Function to extract the strategy from a permissions or access_token request
 * @param req
 */
function getStrategy(req) {
    var rawStrategy;

    if (req.query && req.query.strategy) {
        rawStrategy = req.query.strategy;
    }

    if (!rawStrategy) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.strategy) {
            rawStrategy = jsonBody.strategy;
        }
    }
    if (rawStrategy) {
        var sanitizedStrategy = validator.toString(rawStrategy);
        return sanitizedStrategy;
    }
}


/**
 * Utility method for extracting the access_token from either
 * a query parameter, body parameter, or header.
 *
 * @param req
 * @returns access_token if available via one of these strategies
 */
function getAccessToken(req) {

    var rawToken;

    if (req.query && req.query.access_token) {
        rawToken = req.query.access_token;
    }

    if (!rawToken && req.params && req.params.access_token) {
        rawToken = req.params.access_token;
    }

    if (!rawToken) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.access_token) {
            rawToken = jsonBody.access_token;
        }
    }

    if (!rawToken && req.headers && req.headers.authorization) {

        var authPieces = req.headers.authorization.split(' ');

        if (authPieces.length === 2) {
            var type = authPieces[0];
            var token = authPieces[1];

            if (type === 'Bearer' && token) {
                rawToken = token;
            }
        }
    }

    if (rawToken) {
        var sanitizedToken = validator.toString(rawToken);
        if (validator.isUUID(sanitizedToken, 4)) {
            return sanitizedToken;
        }
    }

}

/**
 * Utility method for extracting the permissions from either
 * a query parameter or the body.
 *
 * @param req
 * @returns permissions if available via one of these strategies
 */
function getPermissions(req) {

    var rawPermissions;

    if (req.query && req.query.permissions) {
        rawPermissions = req.query.permissions;
    }

    if (!rawPermissions && req.params && req.params.permissions) {
        rawPermissions = req.params.permissions;
    }

    if (!rawPermissions) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.permissions) {
            rawPermissions = jsonBody.permissions;
        }
    }

    if (!rawPermissions) {
        return null;
    }

    return sanitizePermissions(rawPermissions);
}

/**
 * Utility method for extracting and validating a set of batch permissions from
 * a request. The request can consist of an array full of strings or other strings.
 *
 * @param req
 */
function getBatchPermissions(req) {

    var rawPermissions;

    if (req.query && req.query.permissions) {
        rawPermissions = req.query.permissions;
    }
    if (!rawPermissions && req.params && req.params.permissions) {
        rawPermissions = req.params.permissions;
    }
    if (!rawPermissions) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.permissions) {
            rawPermissions = jsonBody.permissions;
        }
    }
    if (!rawPermissions) {
        return null;
    }
    return validation.validateBatchPermissions(rawPermissions);
}


/**
 * Utility method for extracting the logical permission op from either
 * a query parameter or the body. Values can be AND, OR,
 */
function getPermissionOp(req) {

    var rawPermissionOp;
    if (req.query && req.query.op) {
        rawPermissionOp = req.query.op;
    }
    if (!rawPermissionOp && req.params && req.params.op) {
        rawPermissionOp = req.params.op;
    }
    if (!rawPermissionOp) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.op) {
            rawPermissionOp = jsonBody.op;
        }
    }
    if (!rawPermissionOp) {
        return 'and';
    }
    return sanitizePermissions(rawPermissionOp);
}

var permissionRegEx = /^[A-Za-z0-9\.]*$/;

/**
 * Go through a string of permissions and validate each string and
 * convert the string to an array
 * @param rawPermissions The raw permission string
 */
function sanitizePermissions(rawPermissions) {
    var permissionsArray = rawPermissions;
    if (!Array.isArray(rawPermissions)) {
        var sanitizedPermissions = validator.toString(rawPermissions);
        permissionsArray = sanitizedPermissions.split(' ');
    }
    for (var i = 0; i < permissionsArray.length; i++) {
        var perm = permissionsArray[i];
        if (!permissionRegEx.test(perm)) {
            return null;
        }
    }
    return permissionsArray;
}


/**
 * Fetch the origins field from either a query parameter
 * or the body. This is NOT the origin header field.
 * Takes a callback of type function(err, value)
 */
function getOrigin(req) {

    var logger = require('./loggers').getLogger();
    var rawOrigin;
    // Choose x-forwarded-host over the origin header if available.
    if (req.headers['x-forwarded-for']) {
        rawOrigin = req.headers['x-forwarded-for'];
        if (rawOrigin) {
            logger.info('Origin 1/3) Origin value from forwarded host: ' + rawOrigin);
        }
    }
    if (!rawOrigin && req.headers['origin']) {
        rawOrigin = req.headers['origin'];
        if (rawOrigin) {
            logger.info('Origin 2/3) Origin Value from origin header: ' + rawOrigin);
        }
    }
    if (!rawOrigin && req.headers['referer']) {
        rawOrigin = req.headers['referer'];
        if (rawOrigin) {
            logger.info('Origin 3/3) Origin Value from referer header: ' + rawOrigin);
        }
    }
    var sanitizedOrigin;
    if (rawOrigin) {
        if (typeof(rawOrigin) !== 'string') {
            logger.error('Type of origin value is not string: ' + typeof(rawOrigin));
            throw new errors.BadRequestError('invalidOriginFormat');
        }
        sanitizedOrigin = validator.toString(rawOrigin);
        // This will throw exceptions if it can't be parsed
        var pack = splitURL(sanitizedOrigin);
        sanitizedOrigin = pack.hostname;
    }
    return sanitizedOrigin;
}

function getLocale(req) {
    return 'en';
}

/**
 * Handle splitting up an origin URL into protocol and domain. This is a bit of a pain since the
 * format of what we're accepting doesn't necessarily have all the pieces
 */
function splitURL(url) {
    var pack = {};
    var tempUrl;
    if (url && ( (url.indexOf('http:') == -1) && (url.indexOf('https') == -1) )) {
        tempUrl = 'http://' + url;
    } else {
        tempUrl = url;
    }
    // This will throw exceptions if the url can't be parsed
    var uri = urlParse.parse(tempUrl);
    pack.protocol = uri.protocol;

    if (url.indexOf('*') != -1) {
        // Worry about formatting later
        pack.hostname = url;
    } else {
        pack.hostname = uri.hostname;
    }
    return pack;
}

/**
 * Get the host value from the request. This prefers the forwarded host header (if provided)
 * over the local host
 * @param req
 */
var getHost = function (req) {

    var host = req.headers.host;
    if (req.headers['x-forwarded-host']) {
        host = req.headers['x-forwarded-host'];
    }
    return host;
};

/**
 * Get the value of the specified header.
 * @param req the HTTP request
 * @param headerName the name of the header
 */
var getHeader = function (req, headerName) {
    var headerValue;
    if (req.headers && req.headers[headerName]) {
        headerValue = req.headers[headerName];
    }
    return headerValue;
};

/**
 * Get the transaction token from wherever it may be. This is suitable for downstream proxy
 * clients where an auth generated tx code is present
 * @param req request object, null if none found
 */
var getTx = function (req) {
    return getHeader(req, scopes.TRANSACTION_HEADER_KEY);
};

// Return a fresh transaction code. This is primarily for the authProxy code that forwards requests with a
// transaction scope
var getNewTx = function () {
    return uuid.v4();
};

/**
 * Get the processId from the req header or from the body of a posted event.
 * @param req request object, null if none found
 */
var getProcessId = function (req) {
    var processId = getHeader(req, scopes.PROCESS_HEADER_KEY);
    if (processId) {
        return processId;
    }
    var bodyAsJSON = getBodyAsJSON(req);
    if (bodyAsJSON && bodyAsJSON.processId) {
        return bodyAsJSON.processId;
    }
};


var getUsername = function (req) {

    var username;
    if (req.query && req.query.username) {
        username = req.query.username;
        if (!validation.usernameValidator(username)) {
            throw new errors.BadRequestDetailsError('invalidUsername', username);
        }
        return username;
    }
    throw new errors.BadRequestError('invalidUsername');

};
module.exports.getUsername = getUsername;

/**
* Check if a single permission string exists in a longer permission string
* @param permission Single permission
* @param permissions The permissions that a user has been given, expected as a concatenated string
* @returns {boolean}
*/
var simplePermissionCheck = function(permission, permissions) {
    if (!permission || !permissions) {
        return false;
    }

//Create an array of permissions by removing spaces and splitting by comma.

    var logger = require('./loggers').getLogger();
    logger.debug('permissions string: ' + permissions + ' typeof [permissions]: ' + typeof(permissions) +
    ', checking for: ' + permission + ' typeof permission: ' + typeof(permission));


    var spos = permissions.indexOf(permission);
    logger.debug('permissions Array has: ' + permissions.length + ' elements, spos === ' + spos);

    for (var v = 0; v < permissions.length; v++) {
        logger.debug('permission element: ' + v + ' = ' + permissions[v] + ' ==? ' +  (permissions[v] === permission) );
    }

    return (spos  > -1);
};
module.exports.simplePermissionCheck = simplePermissionCheck;

/**
 * This function should be used to attempt to find a resource 'owner'
 * name in a request body
 */
var getOwner = function (req) {

    var owner;
    if (!owner) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.owner) {
            return jsonBody.owner;
        }
    }
    throw new errors.BadRequestError('invalidUsername');
};
module.exports.getOwner = getOwner;


var USER_NAME_KEY = 'com.icesoft.services.auth.user.name';
module.exports.USER_NAME_KEY = USER_NAME_KEY;

/**
 * Convenience method for getting the value of the username header:
 *
 *   com.icesoft.services.auth.user.name
 *
 * The username is the name that uniquely identifies a user for the account
 * and realm within our services system.
 *
 * @param req The HTTP request object.
 */
function getUserNameHeader(req) {
    return req.get(USER_NAME_KEY);
}
module.exports.getUserNameHeader = getUserNameHeader;


/**
 * Convenience method for setting the value of the username header:
 *
 *   com.icesoft.services.auth.user.name
 *
 * The username is the name that uniquely identifies a user for the account
 * and realm within our services system.
 *
 * @param req The HTTP request object.
 * @param username The username value.
 */
function setUserNameHeader(req, username) {
    req.headers[USER_NAME_KEY] = username;
}
module.exports.setUserNameHeader = setUserNameHeader;


var ROLE_KEY = 'com.icesoft.services.auth.user.roles';
module.exports.ROLE_KEY = ROLE_KEY;

/**
 * Convenience method for setting the value of the roles header:
 *
 *   com.icesoft.services.auth.user.roles
 *
 * Pass the users current role collection to downstream
 * proxy targets as they'll need to do role checking without accessing
 * the user record itself.
 *
 * @param req The HTTP request object.
 * @param roles The roles array value.
 */
function setRoleHeader(req, roles) {
    if (!roles) {
        roles = [];
    }
    req.headers[ROLE_KEY] = JSON.stringify(roles);
}
module.exports.setRoleHeader = setRoleHeader;


/**
 * retrieve the user roles array as an array of string.
 * Returns empty array if no roles defined
 * @param req
 * @returns {*}
 */
function getRoleHeader(req) {
    return JSON.parse(req.get(ROLE_KEY));
}
module.exports.getRoleHeader = getRoleHeader;



var USER_PERMISSIONS_KEY = 'com.icesoft.services.auth.user.permissions';
module.exports.USER_PERMISSIONS_KEY = USER_PERMISSIONS_KEY;

/**
 * Convenience method for getting the value of the user permissions header:
 *
 *   com.icesoft.services.auth.user.permissions
 *
 * The value can contain a lot of permissions so is always compressed.  This
 * method gets the header, decompresses it, and returns the entire set of
 * permissions.
 *
 * @param req The HTTP request object.
 */
function getUserPermissionsHeader(req) {

    var userPermissions = req.get(USER_PERMISSIONS_KEY);
    if (!userPermissions) {
        return;
    }

    if (config.tools.compressPermissionHeaders) {
        return zlib.inflateSync(userPermissions).toString();
    }
    return userPermissions;
}
module.exports.getUserPermissionsHeader = getUserPermissionsHeader;


/**
 * Convenience method for setting the value of the user permissions header:
 *
 *   com.icesoft.services.auth.user.permissions
 *
 * The value can contain a lot of permissions so is always compressed.
 *
 * Note: Compression only starts to have a real benefit if the string is
 * of a sufficient length (around 42 characters).  However, since
 * the permissions header will typically be longer than that, we'll
 * just always use compression to keep things easier.
 *
 * @param req The HTTP request object.
 * @param permissions Comma separated string of permission values.
 */
function setUserPermissionsHeader(req, permissions) {

    if (config.tools.compressPermissionHeaders) {
        req.headers[USER_PERMISSIONS_KEY] = zlib.deflateSync(permissions);
    } else {
        req.headers[USER_PERMISSIONS_KEY] = permissions;
    }
}
module.exports.setUserPermissionsHeader = setUserPermissionsHeader;


/**
 * Convenience method for checking whether the user permissions header:
 *
 *   com.icesoft.services.auth.user.permissions
 *
 * contains a particular value.
 *
 * @param req The HTTP request object.
 * @param permission The single permission to check for.
 */
function hasUserPermissionInHeader(req, permission) {
    var permissions = getUserPermissionsHeader(req);
    if (!permission || !permissions) {
        return false;
    }

    //Create an array of permissions by removing spaces and splitting by comma.
    var permissionsArray = permissions.replace(/ /g, '').split(',');
    return permissionsArray.indexOf(permission) > -1;
}
module.exports.hasUserPermissionInHeader = hasUserPermissionInHeader;


var SERVICE_TOKEN_KEY = 'com.icesoft.services.auth.service.token';
module.exports.SERVICE_TOKEN_KEY = SERVICE_TOKEN_KEY;

/**
 * Convenience method for getting the value of the service token header:
 *
 *   com.icesoft.services.auth.service.token
 *
 * The service token is the token that services can use to "upgrade"
 * permissions when calling other services, code flows, adapters, etc.
 *
 * @param req The HTTP request object.
 */
function getServiceTokenHeader(req) {
    return req.get(SERVICE_TOKEN_KEY);
}
module.exports.getServiceTokenHeader = getServiceTokenHeader;


/**
 * Convenience method for setting the value of the service token header:
 *
 *   com.icesoft.services.auth.service.token
 *
 * The service token is the token that services can use to "upgrade"
 * permissions when calling other services, code flows, adapters, etc.
 *
 * @param req The HTTP request object.
 * @param serviceToken The service token value.
 */
function setServiceTokenHeader(req, serviceToken) {
    req.headers[SERVICE_TOKEN_KEY] = serviceToken;
}
module.exports.setServiceTokenHeader = setServiceTokenHeader;


var SERVICE_PERMISSIONS_KEY = 'com.icesoft.services.auth.service.permissions';
module.exports.SERVICE_PERMISSIONS_KEY = SERVICE_PERMISSIONS_KEY;

/**
 * Convenience method for getting the value of the service permissions header:
 *
 *   com.icesoft.services.auth.service.permissions
 *
 * The value can contain a lot of permissions so is always compressed.  This
 * method gets the header, decompresses it, and returns the entire set of
 * permissions.
 *
 * @param req The HTTP request object.
 */
function getServicePermissionsHeader(req) {

    var servicePermissions = req.get(SERVICE_PERMISSIONS_KEY);
    if (!servicePermissions) {
        return;
    }

    if (config.tools.compressPermissionHeaders) {
        return zlib.inflateSync(servicePermissions).toString();
    }
    return servicePermissions;
}
module.exports.getServicePermissionsHeader = getServicePermissionsHeader;


/**
 * Convenience method for setting the value of the service permissions header:
 *
 *   com.icesoft.services.auth.service.permissions
 *
 * The value can contain a lot of permissions so is always compressed.
 *
 * Note: Compression only starts to have a real benefit if the string is
 * of a sufficient length (around 42 characters).  However, since
 * the permissions header will typically be longer than that, we'll
 * just always use compression to keep things easier.
 *
 * @param req The HTTP request object.
 * @param permissions Comma separated string of permission values.
 */
function setServicePermissionsHeader(req, permissions) {

    if (config.tools.compressPermissionHeaders) {
        req.headers[SERVICE_PERMISSIONS_KEY] = zlib.deflateSync(permissions);
    } else {
        req.headers[SERVICE_PERMISSIONS_KEY] = permissions;

    }
}
module.exports.setServicePermissionsHeader = setServicePermissionsHeader;


/**
 * Convenience method for checking whether the service permissions header:
 *
 *   com.icesoft.services.auth.service.permissions
 *
 * contains a particular value.
 *
 * @param req The HTTP request object.
 * @param permission The single permission to check for.
 */
function hasServicePermissionInHeader(req, permission) {
    var permissions = getServicePermissionsHeader(req);
    if (!permission || !permissions) {
        return false;
    }

    //Create an array of permissions by removing spaces and splitting by comma.
    var permissionsArray = permissions.replace(/ /g, '').split(',');
    return permissionsArray.indexOf(permission) > -1;
}
module.exports.hasServicePermissionInHeader = hasServicePermissionInHeader;


/**
 * Convenience method for checking if the permission is contained in
 * either the user or the service permission headers.
 *
 * @param req The HTTP request object.
 * @param permission The single permission string to check.
 */
function hasPermissionInHeader(req, permission) {

    if (!ld.isString(permission)) {
        return false;
    }

    return hasUserPermissionInHeader(req, permission) ||
        hasServicePermissionInHeader(req, permission);
}
module.exports.hasPermissionInHeader = hasPermissionInHeader;

/**
 * Convenience method for checking if _any_ of the permission strings
 * in the supplied array are contained in either the user or the
 * service permission headers.
 *
 * @param req The HTTP request object.
 * @param permissions The array of permissions to check
 */
function hasAnyPermissionsInHeaders(req, permissions) {

    if (ld.isString(permissions)) {
        permissions = permissions.replace(/ /g, '').split(',');
    }

    if (!ld.isArray(permissions)) {
        return false;
    }

    return ld.some(permissions, function (perm) {
        return hasPermissionInHeader(req, perm);
    });
}
module.exports.hasAnyPermissionsInHeaders = hasAnyPermissionsInHeaders;


/**
 * Convenience method for checking if _all_ of the permission strings
 * in the supplied array are contained in either the user or the
 * service permission headers.
 *
 * @param req The HTTP request object.
 * @param permissions The array of permissions to check
 */
function hasAllPermissionsInHeaders(req, permissions) {

    if (ld.isString(permissions)) {
        permissions = permissions.replace(/ /g, '').split(',');
    }

    if (!ld.isArray(permissions)) {
        return false;
    }

    return ld.every(permissions, function (perm) {
        return hasPermissionInHeader(req, perm);
    });
}
module.exports.hasAllPermissionsInHeaders = hasAllPermissionsInHeaders;

/**
 * Get the rights object from the request body
 * @param req
 */
function getRights (req) {

    var jsonBody = getBodyAsJSON(req);
    if (jsonBody && jsonBody.rights) {
        return jsonBody.rights;
    }
    return null;
}
module.exports.getRights = getRights;

/**
 * Get the clientMetadata JSON from the request body
 * @param req
 */
function getClientMetadata (req) {

    var jsonBody = getBodyAsJSON(req);
    if (jsonBody && jsonBody.clientMetadata) {
        return jsonBody.clientMetadata;
    }
    return null;
}
module.exports.getClientMetadata = getClientMetadata;

var redisClient;
/**
 * Constructs and returns a redis client object.
 *
 * @returns {Object} Client c
 */
function getRedisClient(redisServerURL, cb) {
    if (!redisClient) {
        redisClient = new Redis(redisServerURL);
        redisClient.on('connect', handleConnect);
        redisClient.on('ready', handleReady);
        redisClient.on('close', handleClose);
    } else {
        cb(null, redisClient);
    }

    function handleConnect() {
        var logger = require('./loggers').getLogger();
        logger.info('redis client connected', redisServerURL);
    }

    function handleReady() {
        var logger = require('./loggers').getLogger();
        logger.debug('redis client ready', redisServerURL);
        redisClient.connected = true;
        cb(null, redisClient);
    }

    function handleClose() {
        var logger = require('./loggers').getLogger();
        logger.debug('redis client closed', redisServerURL);
        //redisClient.connected = false;
    }
}
module.exports.getRedisClient = getRedisClient;


module.exports.getBodyAsJSON = getBodyAsJSON;
module.exports.getStrategy = getStrategy;
module.exports.getAccessToken = getAccessToken;
module.exports.getPermissions = getPermissions;
module.exports.getBatchPermissions = getBatchPermissions;
module.exports.getPermissionOp = getPermissionOp;
module.exports.santizePermissions = sanitizePermissions;
module.exports.getOrigin = getOrigin;
module.exports.notAllowed = notAllowed;
module.exports.preflight = preflight;
module.exports.ping = ping;
module.exports.getLocale = getLocale;
module.exports.getHost = getHost;
module.exports.splitURL = splitURL;
module.exports.getTx = getTx;
module.exports.getNewTx = getNewTx;
module.exports.getProcessId = getProcessId;
