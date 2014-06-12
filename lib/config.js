var config = {};

config.env = {};
config.env.prod = (process.env.NODE_ENV === 'production') ? 'production' : null;

config.service = {};
config.service.name = 'unknown';
config.service.path = '/' + config.service.name;
config.service.server = 'Service description not provided';
config.service.version = '1.0.0';
config.service.port = 55555;

config.notify = {};
config.notify.scheme = 'http';
config.notify.host = 'api.bridgeit.mobi';
config.notify.port = 80;
config.notify.path = '/push/rest';
config.notify.url = config.notify.scheme + '://' + config.notify.host + ':' + config.notify.port + config.notify.path;
config.notify.referrer = config.notify.scheme + '://' + config.notify.host + ':' + config.notify.port + '/' + config.service.name;

config.authorize = {};
config.authorize.host = config.env.prod ? 'auth1' : 'localhost';
config.authorize.url = 'http://' + config.authorize.host + ':55040/auth/';
config.authorize.enabled = config.env.prod ? true : false;

config.database = {};
config.database.host = config.env.prod ? 'db1' : 'localhost';
config.database.port = 27017;
config.database.url = 'mongodb://' + config.database.host + ':' + config.database.port + '/' + config.service.name;

config.swagger = {};
config.swagger.host = config.service.host;
config.swagger.port = config.env.prod ? '' : config.service.port;

config.metrics = {};
config.metrics.host = config.env.prod ? 'metrics1' : 'localhost';
config.metrics.url = 'http://' + config.metrics.host + ':55040/metrics/';
config.metrics.enabled = config.env.prod ? true : false;

config.cors = {};
//config.cors.path = '/\.*/';
config.cors.origin = '*';
config.cors.methods = 'GET, POST, DELETE, PUT';
config.cors.headers = 'Content-Type';

config.logging = {};
config.logging.defaults = {
    logName: "defaultLogger",
    logFile: __dirname + '/' + config.service.name + '.log',
    logLevel: config.env.prod ? 'info' : 'debug'
};

module.exports = config;