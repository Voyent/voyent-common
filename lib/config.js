var config = {};

config.logging = {};
config.logging.defaults = {
    logName: "defaultLogger",
    logFile: __dirname + '/app.log',
    logLevel: 'info'
};

config.service = {};
config.service.name = 'unknown';
config.service.path = '/' + config.service.name;
config.service.server = 'Service description not provided';
config.service.version = '1.0.0';
config.service.port = 55555;

config.database = {};
config.database.url = 'mongodb://localhost/' + config.service.name;

config.notify = {};
config.notify.scheme = 'http';
config.notify.host = 'api.bridgeit.mobi';
config.notify.port = 80;
config.notify.path = '/push/rest';
config.notify.url = config.notify.scheme + '://' + config.notify.host + ':' + config.notify.port + config.notify.path;
config.notify.referrer = config.notify.scheme + '://' + config.notify.host + ':' + config.notify.port + '/' + config.service.name;

config.authorize = {};
config.authorize.enabled = true;
config.authorize.url = 'http://localhost:55010/auth';

config.metrics = {};
config.metrics.enabled = true;
config.authorize.url = 'http://localhost:55040/metrics';

config.cors = {};
//config.cors.path = '/\.*/';
config.cors.origin = '*';
config.cors.methods = 'GET, POST, DELETE, PUT';
config.cors.headers = 'Content-Type';

module.exports = config;