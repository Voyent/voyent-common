
var i18n = require('./errorI18nManager');

/**
 * This is the end of the line error handler. All errors are rendered out here via the
 * <code>return next(err);</code>
 *
 * pattern. This handler is to be inserted at the end of all middleware chains.
 *
 */
var defaultErrorHandler = function(err, req, res, next) {

//    console.log('status --> ' + err.status);    // status is html error codes
//    console.log('message --> ' + err.message);  // human readable message
//    console.log('code --> ' + err.code);    // Error codes from dbs.

    if (err.code && err.code == 11000) {
        err.message = 'duplicateResource';
        err.status = 409;
    }

    // Chose either the user message, or some useful default
    err.status = err.status || 403;
    err.message = err.message || 'Forbidden';
    err.code = err.code || '';

    // Check for a server error and log those so we can catch them
    var mess = i18n.getMessage(req, err);

    if (mess) {
        var msg = {status : err.status, code: err.message, message: mess};
    } else {
        var msg = {status : 'failure', message: err.message};
    }
    if (err.details) {
        msg.details = err.details;
    }
    res.send(err.status, msg);

};

exports.defaultErrorHandler = defaultErrorHandler;