var config = require('./config');
var httpClient = require('request');
var errors = require('./errors');
var query = require('querystring');
var uuid = require('uuid');
var errors = require('./errors');

var btools = require('./tools');

var usernames = {};

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
    completeCheckPermissions(account, realm, origin, accessToken, permissions, 'and', cb );
}
module.exports.checkPermissions = checkPermissions;


/**
 * Check to see if a User identified by access_token has permissions for an operation.
 * Given the identifying arguments, this function makes a network request to the auth
 * server and performs a callback with the results of the check. This function performs
 * a check on the permission block
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

    if(!permissionsArray){
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
        uri: config.auth.url + '/' + account  + '/realms/' + realm + '/permission',
        body: JSON.stringify(body),
        headers: headers
    };

    logger.debug('options: ', JSON.stringify(options));

    httpClient.post(options, function (err, response, body) {

        if (err) {
            logger.error('problem with permissions request', err);
            cb(err);
            return;
        }

        var result = btools.getBodyAsJSON(response);

        if (!result) {
            logger.error('permissions request has no result');
            cb(new errors.PermissionError('permissionNotGranted'));
            return;
        }

        if (response.statusCode == 200) {
            return cb(null, result);
        } else {
            logger.error(body);
            cb(result);
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
                    logger.warn('problem getting service token (passport):' + response.statusCode, response.body);
                    return cb(new errors.OperationError(response.statusCode, response.body));
                }
            } else {
                cb(null, response.body);
            }
        }
    });
}
