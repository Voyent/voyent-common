"use strict";
var validator = require('validator');
var errors = require('./errors');
var urlParse = require('url');

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
    if ("string" === typeof rawData) {
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
    return sanitizeBatchPermissions(rawPermissions);
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
var permissionOpRegEx = /^[and|or]$/;
var MAX_OP_LENGTH = 3;


/**
* Go through a string of permissions and validate each string and
* convert the string to an array
* @param rawPermissions The raw permission string
*/
function sanitizePermissions(rawPermissions){
    var permissionsArray = rawPermissions;
    if(!Array.isArray(rawPermissions)){
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
 * Validate the format of the batch permission request. Single permissions
 * must be the only elements in an array, mixed array and perms is now allowed.
 * Valid:
 * [a], [a, b, c], [[a], [b], [c], [d, e] ]
 *
 * Invalid:
 * [[a]], [a, b, [c, d]]
 */
function sanitizeBatchPermissions(rawPermissions) {
    var permissionsArray = rawPermissions;
    if (!Array.isArray(rawPermissions)) {
        // First level must be array
        throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Entry must be array');
    }
    // Illegal to nest multiple single entry arrays
    if ((permissionsArray.length === 1) && Array.isArray(permissionsArray[0])) {
        throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Single permission entry cant be array');
    }
    // Illegal to mix strings and arrays at a single level
    for (var i = 0; i < permissionsArray.length; i++) {
        if (Array.isArray(permissionsArray[i])) {
            throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Cannot mix permissions and arrays');
        } else {
            if ((typeof (permissionsArray[i]) !== 'string')) {
                throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Permission entry is not string');
            }
            if (!permissionRegEx.test(permissionsArray[i])) {
                throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Permission entry illegal characters');
            }
        }
    }
    return rawPermissions;
}

/**
 * Sanitize the permission op string, returning the
 * logical operation for permission combinations
 */
function sanitizePermissionOp(op){

    if (!op || op.length > MAX_OP_LENGTH || typeof(op) != 'String') {
        return 'and';
    }
    if (!permissionOpRegEx.test(op.toLowerCase())) {
        return 'and';
    }
    return op;
}


/**
 * Fetch the origins field from either a query parameter
 * or the body. This is NOT the origin header field.
 * Takes a callback of type function(err, value)
 */
function getOrigin(req) {

    var logger = require('./loggers').getLogger();
    var rawOrigin;
    logger.info('XX/X getOrigin header dump' );
    logger.info(req.headers);
    // Choose x-forwarded-host over the origin header if available.
    if (req.headers['x-forwarded-host']) {
        rawOrigin = req.headers['x-forwarded-host'];
        if (rawOrigin) {
            logger.info('X1/3) Origin value from forwarded host: ' + rawOrigin);
        }
    }
    if (!rawOrigin && req.headers['origin']) {
        rawOrigin = req.headers['origin'];
        if (rawOrigin) {
             logger.info('X2/3) Origin Value from origin header: ' + rawOrigin);
        }
    }
    if (!rawOrigin && req.headers['referer']) {
        rawOrigin = req.headers['referer'];
        if (rawOrigin) {
             logger.info('X3/3) Origin Value from referer header: ' + rawOrigin);
        }
    }
    var sanitizedOrigin;
    if (rawOrigin) {
        if (typeof(rawOrigin) !=='string') {
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
    if ( url && ( (url.indexOf ('http:') == -1) && (url.indexOf('https') == -1) )) {
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
var getHost = function(req) {

    var host = req.headers.host;
    if (req.headers['x-forwarded-host']) {
        host = req.headers['x-forwarded-host'];
    }
    return host;
};

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