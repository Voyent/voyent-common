var validator = require('validator');
var errors = require('./errors');

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

    if (rawPermissions) {
        var sanitizedPermissions = validator.toString(rawPermissions);
        var permissionsArray = sanitizedPermissions.split(' ');
        var testRegEx = /^[A-Za-z0-9\.]*$/;
        for (var i = 0; i < permissionsArray.length; i++) {
            var perm = permissionsArray[i];
            if (!testRegEx.test(perm)) {
                return null;
            }
        }
        return permissionsArray;
    }

}

/**
 * Fetch the origins field from either a query parameter
 * or the body. This is NOT the origin header field.
 * @param req
 * @returns origin field if available from one of these strategies
 */
function getOrigin(req, callback) {

    var rawOrigin;

    if (req.query && req.query.origin) {
        rawOrigin = req.query.permissions;
    }

    if (!rawOrigin && req.params && req.params.permissions) {
        rawOrigin = req.params.permissions;
    }

    if (!rawOrigin) {
        var jsonBody = getBodyAsJSON(req);
        if (jsonBody && jsonBody.origin) {
            rawOrigin = jsonBody.origin;
        }
    }

    var sanitizedOrigin;
    if (rawOrigin) {
        if (typeof(rawOrigin) !=='string') {
            logger.warn('Origin field not correct type: ' + typeOf(rawOrigin) );
            return callback(new errors.OperationError(401, 'Origin field invalid structure'), null);
        }
        sanitizedOrigin = validator.toString(rawOrigin);
        var testRegEx = /^[A-Za-z0-9\.]*$/;
        if (!testRegEx.test(sanitizedOrigin)) {
            return callback(new errors.OperationError(401, 'Origin field contains invalid characters'), null);

        }
    }
    callback(null, sanitizedOrigin);
}

module.exports.getBodyAsJSON = getBodyAsJSON;
module.exports.getAccessToken = getAccessToken;
module.exports.getPermissions = getPermissions;
module.exports.getOrigin = getOrigin;
module.exports.notAllowed = notAllowed;
module.exports.preflight = preflight;
module.exports.ping = ping;