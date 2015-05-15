"use strict";
var config = require('./config.js');
var validator = require('validator');
var errors = require('./errors');
var urlParse = require('url');
var validation = require('./validation');
var zlib = require('zlib');
var uuid = require('uuid');
var ld = require('lodash');


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
    if (req.headers['x-forwarded-host']) {
        rawOrigin = req.headers['x-forwarded-host'];
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
            logger.error('Type of origin value is not sfgettring: ' + typeof(rawOrigin));
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
 * Get the transaction token from wherever it may be
 * @param req
 */
var getTx = function (req) {

    var rawTx;
    // Client supplied tx in the request query
    if (req.query && req.query.tx) {
        rawTx = req.query.tx;
    }

    // Try to fetch the value from a tx header, which would be supplied to auth proxy to downstream
    // services
    if (!rawTx) {
        if (req.headers) {
            rawTx = req.headers['tx'];
        }
    }
    if (!rawTx) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.tx) {
            rawTx = jsonBody.tx;
        }
    }
    if (!rawTx) {
        // Default is to take a *reasonably* random value
        // It doesn't need to be universally unique, just reasonably recently unique
        rawTx = getNewTx();
    }
    return rawTx;
};

//
var getNewTx = function () {
    return uuid.v4();
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
