//Trying out a more friendly and dynamic configuration utility.  Currently being
//used mainly for mocha tests but could potentially replace our older config.js
//going forward.

function Environment() {

    this.SCHEMES = {
        HTTP: 'http',
        HTTPS: 'https',
        WEBSOCKET: 'ws',
        MONGO: 'mongodb'
    };
    this.defaultScheme = this.SCHEMES.HTTP;

    this.HOSTNAMES = {
        LOCALHOST: 'localhost',
        DOCKER_LOCAL: '192.168.99.100',
        DEV: 'dev.bridgeit.io',
        PROD: 'api.bridgeit.mobi',
        INTERNAL_PROXY: 'web1'
    };
    this.hostname = process.env.BRIDGEIT_HOST || this.HOSTNAMES.DOCKER_LOCAL;

    this.useAuthProxy = false;
    this.useInternalProxy = this.hostname !== this.HOSTNAMES.DOCKER_LOCAL;

    this.services = {};
}

Environment.prototype.isLocalhost = function () {
    return this.hostname === this.HOSTNAMES.LOCALHOST;
};

Environment.prototype.isLocalDocker = function () {
    return this.hostname === this.HOSTNAMES.DOCKER_LOCAL;
};

Environment.prototype.isProduction = function () {
    return process.env.NODE_ENV === 'production';
};

Environment.prototype.getHostname = function () {
    return this.hostname;
};

Environment.prototype.setHostname = function (hostname) {
    this.hostname = hostname;
};

Environment.prototype.usingAuthProxy = function () {
    return this.useAuthProxy;
};

Environment.prototype.setUsingAuthProxy = function (useAuthProxy) {
    this.useAuthProxy = useAuthProxy;
};

Environment.prototype.addService = function (service) {
    this.services[service.getName()] = service;
};

Environment.prototype.getService = function (name) {
    return this.services[name];
};

var env = new Environment();
module.exports = env;



function Service(name, servicePort) {
    this.name = name;
    this.servicePort = servicePort || 80;
    this.scheme = env.defaultScheme;
    this.internalProxy = env.HOSTNAMES.INTERNAL_PROXY;
}

Service.prototype.getName = function () {
    return this.name;
};

Service.prototype.getScheme = function () {
    return this.scheme;
};

Service.prototype.setScheme = function (scheme) {
    this.scheme = scheme;
};

Service.prototype.usingAuthProxy = function () {
    if(this.useAuthProxy === true || this.useAuthProxy === false){
        return this.useAuthProxy;
    }
    return env.usingAuthProxy();
};

Service.prototype.setUsingAuthProxy = function (useAuthProxy) {
    this.useAuthProxy = useAuthProxy;
};

Service.prototype.getHostname = function () {
    if (this.hostname) {
        return this.hostname;
    }

    return env.getHostname();
};

Service.prototype.setHostname = function (hostname) {
    this.hostname = hostname;
};

Service.prototype.getInternalHostname = function () {

    if (env.isLocalhost()) {
        return env.HOSTNAMES.LOCALHOST;
    }

    if (this.internalHostname) {
        return this.internalHostname;
    }

    return env.HOSTNAMES.INTERNAL_PROXY;
};

Service.prototype.setInternalHostname = function (internalHostname) {
    this.internalHostname = internalHostname;
};

Service.prototype.getServicePort = function () {

    if (env.isLocalhost()) {

        if (this.usingAuthProxy()) {
            return env.services.proxy.servicePort;
        }
    }

    return this.servicePort;
};

Service.prototype.setServicePort = function (servicePort) {
    this.servicePort = servicePort;
};

Service.prototype.getServicePath = function () {
    if (this.servicePath) {
        if (this.servicePath === '/') {
            return '';
        }
        return this.servicePath;
    }
    return '/' + this.name;
};

Service.prototype.getServicePathForRealm = function (account, realm) {
    return this.getServicePath() + '/' + account + '/realms/' + realm;
};

Service.prototype.setServicePath = function (servicePath) {
    this.servicePath = servicePath;
};

Service.prototype.getReferrer = function () {
    return this.getScheme() + '://' + this.getHostname();
};

Service.prototype.getExternalHost = function () {
    var thePort = this.getServicePort();
    var theHostname = this.getHostname();
    var theHost = this.getScheme() + '://' + this.getHostname();
    if (thePort === 80 || theHostname !== env.HOSTNAMES.LOCALHOST) {
        return theHost;
    }

    return theHost + ':' + thePort;
};

Service.prototype.getInternalHost = function () {
    var thePort = this.getServicePort();
    var theHostname = this.getInternalHostname();
    var theHost = this.getScheme() + '://' + this.getInternalHostname();
    if (thePort === 80 || theHostname === env.HOSTNAMES.INTERNAL_PROXY) {
        return theHost;
    }

    return theHost + ':' + thePort;
};

Service.prototype.getExternalURL = function () {
    return this.getExternalHost() + this.getServicePath();
};

Service.prototype.getInternalURL = function () {
    return this.getInternalHost() + this.getServicePath();
};

Service.prototype.getExternalURLForRealm = function (account, realm) {
    return this.getExternalHost() + this.getServicePathForRealm(account, realm);
};

Service.prototype.getInternalURLForRealm = function (account, realm) {
    return this.getInternalHost() + this.getServicePathForRealm(account, realm);
};


var proxyService = new Service('proxy', 55010);
proxyService.setServicePath('/');
env.addService(proxyService);

var authService = new Service('auth', 55010);
env.addService(authService);

var authAdminService = new Service('authadmin', 55010);
env.addService(authAdminService);

var locateService = new Service('locate', 55020);
env.addService(locateService);

var contextService = new Service('context', 55060);
env.addService(contextService);

var docsService = new Service('docs', 55080);
env.addService(docsService);

var pushService = new Service('push', 8080);
pushService.setServicePath('/push/rest');
env.addService(pushService);

var dbService = new Service('db', 27017);
dbService.setScheme(env.SCHEMES.MONGO);
dbService.setServicePath('/');
dbService.setInternalHostname('db1');
dbService.setUsingAuthProxy(false);
env.addService(dbService);
