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

if (process.env.DOCKER_LOCAL) {
    config.env.docker = {
        db: 'db:27017',
        metrics: 'metrics:55040',
        naas: 'naas:8080',
        auth: 'auth:55010',
        locate: 'locate:55020',
        storage: 'storage:55030',
        query: 'query:55110',
        mailbox: 'mailbox:55120',
        action: 'action:55130',
        push: 'push:55140',
        msgs: 'msgs:1883',
        doc: 'docs:55080'
    };
}

//Communication between services on either the dev or prod environments should use
//this proxy as the host instead.
config.env.proxyHost = 'web1';

//Everything related to this specific service.  Many of these should be overridden in the
//service's own specific config.js file.
config.service = {};
config.service.namespace = 'bridgeit';
config.service.name = 'defaultServiceName';
config.service.scheme = 'http';
config.service.host = config.env.host;
config.service.port = 55555;
config.service.resourcePort = config.env.host === LOCAL_HOST ? config.service.port : '';
config.service.referrer = config.service.scheme + '://' + config.service.host;
config.service.path = '/' + config.service.name;
config.service.server = 'Service description not provided';
config.service.desc = config.service.server;
config.service.version = '1.0.0';
config.service.tokensEnabled = false;

//With the service proxy enabled, all requests go to the proxy first for process (e.g. authentication)
//and then proxied to the appropriate service.
config.proxy = {};
config.proxy.enabled = false;
config.proxy.scheme = 'http';
config.proxy.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.host;
config.proxy.port = config.env.host === LOCAL_HOST ? ':55010' : '';
config.proxy.url = config.proxy.scheme + '://' + config.proxy.host + config.proxy.port;

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

//TODO: database.path and database.url should likely be removed give we know make connections
//to databases using our own strategy based on account name rather than service.
config.database.path = config.service.name;
config.database.url = config.database.scheme + '://' + config.database.host + ':' + config.database.port + '/' + config.database.path;

config.database.clientExpiry = 1800000;
config.database.sharedConnections = false;

//Information for communicating with the Metrics service.
config.metrics = {};
config.metrics.scheme = 'http';
config.metrics.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.metrics.port = config.env.host === LOCAL_HOST ? ':55040' : '';
config.metrics.path = '/metrics';
config.metrics.url = config.metrics.scheme + '://' + config.metrics.host + config.metrics.port + config.metrics.path;
config.metrics.enabled = config.env.prod ? true : false;

//Information for communicating with the Docs service.
config.doc = {};
config.doc.scheme = 'http';
config.doc.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.doc.port = config.env.host === LOCAL_HOST ? ':55080' : '';
config.doc.path = '/docs';
config.doc.url = config.doc.scheme + '://' + config.doc.host + config.doc.port + config.doc.path;

//Information for communicating with the Docs service.
config.auth = {};
config.auth.scheme = 'http';
config.auth.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.auth.port = config.env.host === LOCAL_HOST ? ':55010' : '';
config.auth.path = '/auth';
config.auth.url = config.auth.scheme + '://' + config.auth.host + config.auth.port + config.auth.path;

//Information for communicating with the Locate service.
config.locate = {};
config.locate.scheme = 'http';
config.locate.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.locate.port = config.env.host === LOCAL_HOST ? ':55020' : '';
config.locate.path = '/locate';
config.locate.url = config.locate.scheme + '://' + config.locate.host + config.locate.port + config.locate.path;

//Information for communicating with the Storage service.
config.storage = {};
config.storage.scheme = 'http';
config.storage.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.storage.port = config.env.host === LOCAL_HOST ? ':55030' : '';
config.storage.path = '/locate';
config.storage.url = config.storage.scheme + '://' + config.storage.host + config.storage.port + config.storage.path;

//Information for communicating with the Context service.
config.context = {};
config.context.scheme = 'http';
config.context.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.context.port = config.env.host === LOCAL_HOST ? ':55060' : '';
config.context.path = '/context';
config.context.url = config.context.scheme + '://' + config.context.host + config.context.port + config.context.path;

//Information for communicating with the Query service.
config.query = {};
config.query.scheme = 'http';
config.query.host = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.query.port = config.env.host === LOCAL_HOST ? ':55110' : '';
config.query.path = '/query';
config.query.url = config.query.scheme + '://' + config.query.host + config.query.port + config.query.path;

//Configuration defaults for the Messaging service.
config.messages = {};
config.messages.host = 'msgs';

//Message client that doesn't broadcast, saves directly to database
config.messages.scheme = 'log';
config.messages.port = '0';

// Configuration defaults for Action Service
config.action = {};
config.action.scheme = 'http';
config.action.host   = config.env.host === LOCAL_HOST ? LOCAL_HOST : config.env.proxyHost;
config.action.port = config.env.host === LOCAL_HOST ? ':55130' : '';
config.action.path = '/action';
config.action.url = config.query.scheme + '://' + config.query.host + config.query.port + config.query.path;

//Messaging via MQTT using ActiveMQ
//config.messages.scheme = 'tcp';
//config.messages.port = '1883';

//Messaging via Redis Pub/Sub
//config.messages.scheme = 'redis';
//config.messages.port = '6379';

//Configuration defaults for the CRUD related features.
config.crud = {};
config.crud.defaultLimit = 100;

//Configuration defaults for the Tools related features.
config.tools = {};
config.tools.compressPermissionHeaders = false;

//Default CORS settings.
config.cors = {};
//config.cors.path = '/\.*/';
config.cors.origin = '*';
config.cors.methods = 'GET, POST, DELETE, PUT';
config.cors.headers = 'Content-Type, Depth, User-Agent, X-File-Size, X-Requested-With, If-Modified-Since, If-Unmodified-Since, X-File-Name, Cache-Control, Origin, X-HTTP-Method-Override, Accept, Authorization, X-Pingother, If-Match, If-None-Match ';

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

// Default resource metadata block per resource. Allow all owner access, but no one else
config.service.defaultPermissionsMetadata = {
    owner: 'unchanged',
    rights: {
        owner: ["r", "u", "d", "x", "pr", "pu"],
        realm: [],
        roles: {}
    }
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
    config.service.resourcePort = config.env.host === LOCAL_HOST ? config.service.port : '';

    config.proxy.url = config.proxy.scheme + '://' + config.proxy.host + config.proxy.port;

    config.notify.url = config.notify.scheme + '://' + config.notify.host + config.notify.port + config.notify.path;
    config.notify.referrer = config.notify.scheme + '://' + config.notify.host + config.notify.port + '/' + config.service.name;

    config.database.path = config.service.name;
    config.database.url = config.database.scheme + '://' + config.database.host + ':' + config.database.port + '/' + config.database.path;

    config.auth.url = config.auth.scheme + '://' + config.auth.host + config.auth.port + config.auth.path;

    config.doc.url = config.doc.scheme + '://' + config.doc.host + config.doc.port + config.doc.path;

    config.locate.url = config.locate.scheme + '://' + config.locate.host + config.locate.port + config.locate.path;

    config.context.url = config.context.scheme + '://' + config.context.host + config.context.port + config.context.path;

    config.query.url = config.query.scheme + '://' + config.query.host + config.query.port + config.query.path;

    config.metrics.url = config.metrics.scheme + '://' + config.metrics.host + config.metrics.port + config.metrics.path;

    config.logging.defaults = {
        logName: config.logging.logName,
        logFile: config.logging.logFile,
        logLevel: config.logging.logLevel
    };

}
module.exports.reconfigure = reconfigure;
