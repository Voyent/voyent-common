var config = {};

//Overall environment settings are stored under config.env
config.env = {};
config.env.prod = (process.env.NODE_ENV === 'production') ? 'production' : null;

var LOCAL_HOST = 'localhost';
var DEV_HOST = 'dev.bridgeit.io';
var PROD_HOST = 'api.bridgeit.mobi';

config.env.host = DEV_HOST;
if (process.env.BRIDGEIT_HOST) {
    config.env.host = process.env.BRIDGEIT_HOST;
}

//Communication between services on either the dev or prod environments should use
//this proxy as the host instead.
config.env.proxyHost = 'web1';

//Everything related to this specific service.  Many of these should be overridden in the
//service's own specific config.js file.
config.service = {};
config.service.name = 'defaultServiceName';
config.service.scheme = 'http';
config.service.host = config.env.host;
config.service.port = 55555;
config.service.path = '/' + config.service.name;
config.service.server = 'Service description not provided';
config.service.desc = config.service.server;
config.service.version = '1.0.0';

//Information for communicating with the Notification service.
config.notify = {};
config.notify.scheme = 'http';
config.notify.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.notify.port = config.env.host === LOCAL_HOST ? ':8080' : '';
config.notify.path = '/push/rest';
config.notify.url = config.notify.scheme + '://' + config.notify.host + config.notify.port + config.notify.path;
config.notify.referrer = config.notify.scheme + '://' + config.notify.host + config.notify.port + '/' + config.service.name;

//Information for communicating with the MongoDB service.
config.database = {};
config.database.scheme = 'mongodb';
config.database.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : 'db1';
config.database.port = 27017;
config.database.path = config.service.name;
config.database.url = config.database.scheme + '://' + config.database.host + ':' + config.database.port + '/' + config.database.path;

//Information for communicating with the Auth service.
config.auth = {};
config.auth.scheme = 'http';
config.auth.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.auth.port = config.env.host === LOCAL_HOST ? ':55010' : '';
config.auth.path = '/auth';
config.auth.url = config.auth.scheme + '://' + config.auth.host + config.auth.port + config.auth.path;
config.auth.enabled = config.env.prod ? true : false;

//Information for communicating with the Metrics service.
config.metrics = {};
config.metrics.scheme = 'http';
config.metrics.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.metrics.port = config.env.host === LOCAL_HOST ? ':55040' : '';
config.metrics.path = '/metrics';
config.metrics.url = config.metrics.scheme + '://' + config.metrics.host + config.metrics.port + config.metrics.path;
config.metrics.enabled = config.env.prod ? true : false;

//Information for configuring Swagger if running dynamically (this will likely go away at some point).
config.swagger = {};
config.swagger.scheme = 'http';
config.swagger.host = config.service.host;
config.swagger.port = config.service.host === LOCAL_HOST ? ':' + config.service.port : '';
config.swagger.apiHost = config.swagger.scheme + '://' + config.swagger.host +  config.swagger.port;
config.swagger.apiPath = '/' + config.service.name + '/api';
config.swagger.url = config.swagger.apiHost + config.swagger.apiPath;

//Default CORS settings.
config.cors = {};
//config.cors.path = '/\.*/';
config.cors.origin = '*';
config.cors.methods = 'GET, POST, DELETE, PUT';
config.cors.headers = 'Content-Type';

//Default logging settings.
config.logging = {};
config.logging.logName = "defaultLogger";
config.logging.logFile = __dirname + '/' + config.service.name + '.log';
config.logging.logLevel = config.env.prod ? 'info' : 'debug';
config.logging.defaults = {
    logName: config.logging.logName,
    logFile: config.logging.logFile,
    logLevel: config.logging.logLevel
};

//Export the config object so that services can use it and override as required.
module.exports = config;


//Configuration settings that rely on being calculated from other values should
//be added to this function.  Whenever one or more configuration values are updated,
//this function should be called to ensure all the values are properly re-evaluated.
//While this is not terribly elegant or efficient, it is fairly simple, compatible with
//what we have and retains the high degree of readability for all the settings.  Since
//the configuration typically only gets modified once when the service is first started
//up, the impact is minimal.  Settings that rely on the config.env properties should
//not be recalculated or they cannot be overridden.
function reconfigure() {

    config.service.path = '/' + config.service.name;

    config.notify.url = config.notify.scheme + '://' + config.notify.host + config.notify.port + config.notify.path;
    config.notify.referrer = config.notify.scheme + '://' + config.notify.host + config.notify.port + '/' + config.service.name;

    config.database.path = config.service.name;
    config.database.url = config.database.scheme + '://' + config.database.host + ':' + config.database.port + '/' + config.database.path;

    config.auth.url = config.auth.scheme + '://' + config.auth.host + config.auth.port + config.auth.path;

    config.metrics.url = config.metrics.scheme + '://' + config.metrics.host + config.metrics.port + config.metrics.path;

    config.swagger.port = config.service.host === LOCAL_HOST ? ':' + config.service.port : '';
    config.swagger.apiHost = config.swagger.scheme + '://' + config.swagger.host +  config.swagger.port;
    config.swagger.apiPath = '/' + config.service.name + '/api';
    config.swagger.url = config.swagger.apiHost + config.swagger.apiPath;

    config.logging.defaults = {
        logName: config.logging.logName,
        logFile: config.logging.logFile,
        logLevel: config.logging.logLevel
    };

}
module.exports.reconfigure = reconfigure;
