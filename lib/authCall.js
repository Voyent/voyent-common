var config = require('./config');
var httpClient = require('request');
var query = require('querystring');
var uuid = require('uuid');

var btools = require('./tools');

var usernames = {};

/**
 * A common requirement for a service is to query the permissions granted to a user,
 * and to cache these permission checks to keep from pinging the server continually
 * with the same requests.
 *
 * This module makes it easy to perform the authorization request, but the new auth API
 * makes it difficult to perform caching, so this module does not do it.
 * @params access_token Users access_token
 * @params realm The Realm name
 * @params reqdPermission Space separated string of Permissions
 * @params callback async callback accepting a boolean true (pass) or false (fail) value
 */
function checkAccess(access_token, realm, reqdPermission, callback) {

    //In order to have modules respect the logging configuration supplied by the service, we
    //need to get the logger in a 'lazy' fashion.  If we get it during initialization, then
    //the logger instance only has the default configuration.
    var logger = require('./loggers').getLogger();

    //Sometimes you may want to test your service without having to worry about having valid
    //entries in the authorization database.  Setting this configuration parameter to 'false'
    //will tell this method to 'automatically pass' the permission check.
    if (!config.auth.enabled) {
        logger.warn('[config.auth.enabled = ' + config.auth.enabled + ']',
            '** Permission checking has been disabled. It should be re-enabled in a production environment. **');
        callback(true);
        return;
    }

    logger.debug('authorization check, access_token: ' +
        access_token + ', realm: ' + realm + ' required permission: ' + reqdPermission);
    if (!access_token) {
        logger.error('Missing access_token');
        callback(false);
        return;
    }

    if (!realm) {
        logger.error('Missing Realm field');
        callback(false);
        return;
    }

    if (!reqdPermission) {
        logger.error('Missing required permission block');
        callback(false);
        return;
    }

    logger.debug('access_token: ' + access_token + '  realm: ' + realm);
    var hdrs = {
        'Content-type': 'application/json'
    }

    var debugHost = 'http://localhost:9090';
    var permArray = [];
    permArray.push(reqdPermission);
    var body = { access_token: access_token, permissions: permArray};
    var options = {
        uri: config.auth.url + '/' + realm + '/token/permissions',
//        uri: debugHost + '/auth/' + realm + '/token/permissions',
        body: JSON.stringify(body),
        headers: hdrs
    };
    logger.debug('options: ', options);
    httpClient.post(options, function (err, response, body) {
        if (err) {
            callback(false);
        }
        var result = btools.getBodyAsJSON(response);

        if (!result) {
            logger.error('no response body');
            callback(false);
        }

        var pass = result.msg === 'permission(s) granted';
        if (pass) {
            usernames.access_token = result.username;
        }
        callback(pass);
    });
}

/**
 * A common requirement for a service is to query the permissions granted to a user,
 * and to cache these permission checks to keep from pinging the server continually
 * with the same requests.
 *
 * This module makes it easy to perform the authorization request, but the new auth API
 * makes it difficult to perform caching, so this module does not do it.
 * @params access_token Users access_token
 * @params realm The Realm name
 * @params reqdPermission Space separated string of Permissions
 * @params callback async callback accepting a boolean true (pass) or false (fail) value
 */
function validatePermission(token, realm, permission, callback) {

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
        callback(null, {msg: 'permission(s) granted', username: 'developmentUser'});
        return;
    }

    logger.debug('verifyPermission:' +
        '\n  access_token: ' + token +
        '\n  realm: ' + realm +
        '\n  required permission: ' + permission);

    var errorMessage;
    if (!token) {
        errorMessage = 'missing access_token';
        logger.error(errorMessage);
        callback(errorMessage);
        return;
    }

    if (!realm) {
        errorMessage = 'missing realm';
        logger.error(errorMessage);
        callback(errorMessage);
        return;
    }

    if (!permission) {
        errorMessage = 'missing permission';
        logger.error(errorMessage);
        callback(errorMessage);
        return;
    }

    var hdrs = {
        'Content-type': 'application/json'
    };

    var body = { access_token: token, permissions: [permission]};
    var options = {
        uri: config.auth.url + '/' + realm + '/token/permissions',
        body: JSON.stringify(body),
        headers: hdrs
    };

    logger.debug('options: ', JSON.stringify(options));

    httpClient.post(options, function (err, response, body) {

        if (err) {
            logger.error(errorMessage);
            callback(err);
            return;
        }

        var result = btools.getBodyAsJSON(response);

        if (!result) {
            logger.error(errorMessage);
            callback(err);
            return;
        }

        var pass = (result.msg === 'permission(s) granted');

        if (!pass) {
            logger.error(result.msg);
            callback({msg: 'permission(s) denied', err: result.msg});
            return;
        }
        usernames.access_token = result.username;
        callback(null, result);
    });
}

/**
 * Fetch the username from the last auth check. This function removes the
 * username from the map in order to prevent the ever growing access_token map,
 * but users must be aware that calling this without an auth check first will fail
 * because the username hasn't been fetched yet.
 * @param access_token
 */
function getUsernameForToken(access_token) {
    var logger = require('./loggers').getLogger();
    var returnval = usernames.access_token;
    if (usernames.access_token) {
        delete usernames.access_token;
    }
    if (!returnval) {
        logger.debug('username cache empty?');
    }
    return returnval;
}

exports.checkAccess = checkAccess;
exports.validatePermission = validatePermission;
exports.getUsernameForToken = getUsernameForToken;


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
            logger.warn('problem with token request', err);
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


//This handles the HTTP call to the Auth service to get the access_token.  The
//credentials should contain a username and a password.  The callback will return
//an error or an access_token.
function requestServiceToken(credentials, cb) {

    var logger = require('./loggers').getLogger();

    var headers = {
        'Content-type': 'application/json',
        'Referer': config.notify.referrer
    };

    var queryParams = {
        username: credentials.username,
        password: credentials.password
    };

    var options = {
        uri: config.auth.url + '/' + realm + '/token/local',
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
                logger.warn('problem getting service token:' + response.statusCode, response.body);
                return cb({"error": "could not get service token", "response": response.body}, null);
            }

            cb(null, response.body);
        }
    });
}
