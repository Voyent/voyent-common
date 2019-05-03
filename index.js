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
 * Returns a set of the exports for the entire module.
 *
 * If, optionally, a set of keys and a callback are provided, the exports are
 * returned asynchronously.
 *
 * This library is used by all of our Node-based services.  It used to simply
 * return all the exported sub-modules.  However we needed to change the behaviour
 * to support getting and setting the environment variables from the S3 bucket.
 *
 * The main issue is that the S3 bucket contains configuration files that we
 * want to set as environment variables which are made available to all of the
 * service code.  Therefore, it's important that these variables are set first,
 * before any other code is executed.  This is of particular importance for things
 * like the db connection string that is stored as DB_URI in common.config.
 *
 * So the module provides a function as the default return value.  When requiring
 * voyent-common, instead of calling:
 *
 * const vc = require('voyent-common');
 * const logger = vc.loggers.getLogger();
 *
 * You should now call "require" and then execute the returned value as a
 * function. In most places, the usage barely changes:
 *
 * const vc = require('voyent-common')();
 * const logger = vc.loggers.getLogger();
 *
 * For the special case of the service startup, the function can optionally take
 * an array of filename keys and a callback.  The array will look something like:
 *
 * ['common.config', 'action-service-node.config']
 *
 * In general, the keys and callback only need to be used during service startup
 * to ensure the environment variables are set before the sub-modules are
 * evaluated and returned. In those cases, the value that is returned as a result of the
 * async callback can then be used as normal:
 *
 * require('voyent-common')( configFilenames, function(err, vc){
 *     const logger = vc.loggers.getLogger();
 * }
 *
 * @param keys (optional) Array of S3 bucket keys
 * @param cb (optional) Function to execute after the S3 bucket values have been fetched
 *           and set as environment variables.
 * @returns {*} The exported sub modules.  These are always returned whether or
 *              not there was an error.
 */
module.exports = function (keys, cb) {

    if(!keys || !cb){
        if(!cb){
            return getExports();
        }
        cb(null, getExports());
    }

    if (environmentProperties) {
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