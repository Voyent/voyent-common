const startup = require('./lib/aws-startup');
console.log('importing voyent-common index.js, started loading environment properties');

let environmentProperties;

function getExports() {
    return {
        config: require('./lib/config'),
        db: require('./lib/db'),
        logger: require('./lib/logger'),
        loggers: require('./lib/loggers'),
        tools: require('./lib/tools'),
        security: require('./lib/security'),
        errorHandlers: require('./lib/errorHandlers'),
        errors: require('./lib/errors'),
        authCall: require('./lib/authCall'),
        validation: require('./lib/validation'),
        crud: require('./lib/crud'),
        crudx: require('./lib/crud-extended'),
        query: require('./lib/query'),
        scopes: require('./lib/scopes'),
        lock: require('./lib/lock'),
        runtimeEnvironment: require('./lib/runtimeEnvironment'),
        awsCommon: require('./lib/aws-common'),
        awsSQSClient: require('./lib/aws-sqs-client'),
    };
}

/**
 * Returns a set of the exports for the entire module.  If an optional callback
 * is provided, the exports are returned asynchronously.
 *
 * This library is used by all of our Node-based services.  It used to simply
 * return all the exported sub-modules but we needed to change that to support
 * getting and setting the environment variables from the S3 bucket.
 *
 * The main issue is that the S3 bucket contains configuration files that we
 * want to set as environment variables that are available to all other service
 * code.  However, it's important that these variables are set first, before
 * any other code is run.  This is of particular importance for the db connection
 * string that is stored as DB_URI in common.config.
 *
 * So the module now returns a function.  Instead of calling:
 *
 * const vc = require('voyent-common');
 * const logger = vc.loggers.getLogger();
 *
 * You should now call "require" as a function. In most places, the usage
 * barely changes:
 *
 * const vc = require('voyent-common')();
 * const logger = vc.loggers.getLogger();
 *
 * The function can optionally take a callback.  The callback only needs
 * to be used to ensure the environment variables are set before the sub-modules
 * are returned.  This is generally only done in the start.js files of our
 * services.  In those cases, the value that is returned as a result of the
 * async callback can then be used as normal:
 *
 * require('voyent-common')( function(err, vc){
 *     const logger = vc.loggers.getLogger();
 * }
 *
 * @param cb (optional)
 * @returns {*} The exported sub modules.
 */
module.exports = function (keys, cb) {

    if(!keys || !cb){
        console.log('voyent-common/index.js: missing param(s)', keys, cb);
        return getExports();
    }

    if (environmentProperties) {
        console.log('voyent-common/index.js: environment properties already set');
        return cb(null, getExports());
    }

    startup.loadEnvironmentProperties( keys,function (err, props) {

        if (err) {
            console.log('could not load environment properties', err.message);
            return cb(new Error('could not load environment properties'), getExports());
        }

        console.log('loaded', Object.keys(props).length, 'environment properties', props.DB_URI);
        cb(null, getExports());
    });

};