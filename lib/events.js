var db = require('./db');
var ld = require('lodash');

var mqtt = require('mqtt');
var Redis = require('ioredis');


var config;
var connectClientPromise;
var messagingClient;

var connectionPromise;
var mqttClient;


/**
 * Allow the logging message client to save the events to the database.  This
 * would normally be done by the event hub or the listener responsible for processing
 * the events.  However, the logging message client doesn't broadcast anything so it
 * needs to do it in any case.
 *
 * @param event {Object} The standard event object.
 */
function saveEventToDB(event) {

    var logger = require('./loggers').getLogger();

    if (ld.isString(event)) {
        try {
            event = JSON.parse(event);
        } catch (e) {
            logger.error('could not parse event string', event, e);
            return;
        }
    }

    logger.debug('saving event to db', event);

    var newEvent = {
        _data: event,
        _permissions: {
            owner: event.username || 'unchanged',
            rights: {
                owner: ["r"],
                realm: ["r"],
                roles: {}
            }
        }
    };

    var collectionName = 'events';

    db.getCollection(event.account, event.realm, collectionName, function (err, coll) {

        if (err) {
            logger.error('could not get collection: ' + event.account + ' -> ' + event.realm + '.' + collectionName, err);
            return;
        }

        coll.insert(newEvent, {w: 1}, function (err, result) {

            if (err) {
                logger.error('could not save event', err);
                return;
            }

            logger.debug('successfully saved event', result);
        });

    });
}


/**
 * Checks to ensure that the topic is valid.
 *
 * @param topic
 * @returns {boolean}
 */
function isValidTopic(topic) {

    var logger = require('./loggers').getLogger();

    if (!topic || !ld.isString(topic)) {
        logger.warn('topic must be a string (e.g. events/myaccount/myrealm/docs/create)', topic);
        return false;
    }
    return true;
}


/**
 * Checks to ensure that the message is valid.
 *
 * @param message
 * @returns {boolean}
 */
function isValidMessage(message) {

    var logger = require('./loggers').getLogger();

    if (!message || (!ld.isString(message) && !ld.isObject(message))) {
        logger.warn('message must be a string or an object that can be converted to a String', message);
        return false;
    }
    return true;
}


/**
 * Ensures the message is a valid JSON string.
 *
 * @param message
 * @returns {*}
 */
function normalizeMessage(message) {

    var logger = require('./loggers').getLogger();

    var safeMessage = message;

    if (ld.isString(message)) {
        try {
            JSON.parse(message);
        } catch (e) {
            safeMessage = {"msg": message};
        }
    }

    if (ld.isObject(message)) {
        try {
            safeMessage = JSON.stringify(message);
        } catch (e) {
            logger.warn('cannot JSON.stringify message', message);
        }
    }

    return safeMessage;
}

/**
 * Determine the URL to the messaging service based on information in the configuration.
 *
 * @param config
 *
 * @returns {string} The URL to the message queue service.
 */
function getMessagingURL(config) {

    var logger = require('./loggers').getLogger();

    var messagingURL = config.messages.scheme + '://' + config.messages.host + ':' + config.messages.port;
    if (config.env.hosts && config.env.hosts.msgs) {
        messagingURL = config.messages.scheme + '://' + config.env.hosts.msgs;
    }
    logger.debug('messaging URL', messagingURL);

    return messagingURL;
}


/**
 * Publishes a message to the specified topic.
 *
 * @param topic {String} A hierarchical topic string that follows a set pattern
 *                       (e.g. events/myaccount/myrealm/docs/create).
 * @param message {String} The message to publish.  If an Object is provided, it
 *                         will be converted to a String.
 *
 */
function publishMessage(topic, message) {

    var logger = require('./loggers').getLogger();

    if (!messagingClient || !messagingClient.isConnected) {
        logger.warn('messaging client missing or not connected, cannot send message', topic, message);
        return;
    }

    if (isValidTopic(topic) && isValidMessage(message)) {
        var normalizedMessage = normalizeMessage(message);
        logger.debug('publishing message', topic, normalizedMessage);
        messagingClient.publish(topic, normalizedMessage);
        saveEventToDB(normalizedMessage);
    }
}


/**
 * Convenience method for publishing a service event.  For details of required and optional properties
 * of the event, see createEvent().
 *
 * @param event
 */
function publishServiceEvent(event) {
    var topic = 'events/' + event.account + '/' + event.realm + '/' + event.service + '/' + event.event;
    publishMessage(topic, event);
}


/**
 * Create a valid event object form the supplied parameters.
 *
 * @param account {String}  The name of the account. Required.
 * @param realm {String}    The name of the realm. Required
 * @param service {String}  The name of the service (e.g. docs). Required.
 * @param event {String}    The name of the event (e.g. create). Required
 * @param type {String}     The type of the resource (e.g. blob, doc, location, etc.). Required.
 * @param username {String} The name of the user that initiated the event. Required.
 * @param data {Object}     Custom data for this event, specific to the service that published it.  Optional.
 * @returns {Object}        A standard event object created from the parameters.
 */
function createEvent(account, realm, service, event, type, username, data) {

    var logger = require('./loggers').getLogger();

    if (arguments.length < 6 || arguments.length > 7) {
        logger.warn('could not create event, should have 6-7 arguments', arguments.length);
        return null;
    }

    var officialEvent = {
        "time": new Date().toISOString(),
        "account": account,
        "realm": realm,
        "service": service,
        "event": event,
        "type": type,
        "username": username
    };

    officialEvent.data = data || {};

    return officialEvent;
}

/**
 * A barrel typically contains all the information required to create an event so
 * this function is a convenience that pulls the relevant info and then calls through
 * to createEvent(account, realm, service, event, type, username, data).
 *
 * @param barrel {Object}  The general container for all properties carried through a
 *                         services waterfall of functions.
 * @returns {Object}       A standard event object created from the barrel.
 */
function createEventFromBarrel(barrel) {

    var logger = require('./loggers').getLogger();

    logger.debug('creating service event from barrel');

    //First check to see if barrel is missing any required information.
    var paramErrors = [];
    if (!barrel.account && !barrel.accountId) {
        paramErrors.push('barrel.account or barrel.accountId');
    }

    if (!barrel.realmId) {
        paramErrors.push('barrel.realmId');
    }

    if (!config.service.name) {
        paramErrors.push('config.service.name');
    }

    if (!barrel.serviceEvent) {
        paramErrors.push('barrel.serviceEvent');
    }

    if (!barrel.resourceType) {
        paramErrors.push('barrel.resourceType');
    }

    if (!barrel.username) {
        paramErrors.push('barrel.username');
    }

    if (paramErrors.length > 0) {
        logger.warn('missing parameters to create event = ', paramErrors);
        return null;
    }

    //Then massage the information we have so that we can create an event.
    var account = barrel.account || barrel.accountId;

    var customData = barrel.serviceEventData || {};

    if (barrel.validatedResourceId || barrel.resourceId) {
        customData.resourceId = barrel.validatedResourceId || barrel.resourceId;
    }
    if (barrel.req && barrel.req.headers && barrel.req.headers.host) {
        customData.origin = barrel.req.headers.host;
    }
    if (barrel.startTime) {
        customData.processTime = new Date().getTime() - barrel.startTime;
    }

    if (barrel.resourceId) {
        if (!barrel.serviceEventData) {
            barrel.serviceEventData = {};
        }
        barrel.serviceEventData.resourceId = barrel.resourceId;
    }

    return createEvent(
        account,
        barrel.realmId,
        config.service.name,
        barrel.serviceEvent,
        barrel.resourceType,
        barrel.username,
        customData);
}


/**
 * Convenience method for publishing a service event based on the information in a barrel.  For details
 * of required and optional properties of the event, see createEvent().
 *
 * @param barrel
 */
function publishServiceEventFromBarrel(barrel) {
    var event = createEventFromBarrel(barrel);
    publishServiceEvent(event);
}


/**
 * Creates and returns a messaging client that simply logs published events.
 * Mostly suited to testing when you don't have or want to run the actual message
 * queue service.
 */
function createLoggingClient() {

    var logger = require('./loggers').getLogger();

    function connect() {
        return new Promise(function (resolve) {
            resolve();
        });
    }

    function isConnected() {
        return true;
    }

    function publish(topic, message, options) {
        logger.debug('logging message client publishing: ', topic, message, options);
    }

    function subscribe(patterns) {
        logger.debug('logging message client subscribing: ', patterns);
    }

    return {
        connect: connect,
        isConnected: isConnected,
        publish: publish,
        subscribe: subscribe,
        getEventSource: logger
    };
}


/**
 * Creates and returns a messaging client that uses the MQTT protocol to
 * publish events.  The client does not connect by default.  The connect()
 * method should be used as it returns a Promise that can be used to ensure
 * when the connection has been established.
 */
function createMQTTClient() {

    var logger = require('./loggers').getLogger();

    function getClientId() {

        //For durable subscriptions, the clientId should be something "permanent"
        //that relates to this instance of the service.  In this case we use default
        //to the service name but if there is an environment variable MSGS_NAME we
        //use that.  That variable should be present in Docker containers.
        var clientId = 'icesage_mqtt_client';
        var suffix = '_' + config.service.name;
        if (process.env.MSGS_NAME) {
            suffix = process.env.MSGS_NAME.replace(/\//g, '_');
        }
        clientId = clientId + suffix;
        logger.debug('MQTT messaging client id', clientId);
        return clientId;
    }

    function connect() {

        logger.debug('MQTT connect() called');

        if (!connectionPromise) {

            connectionPromise = new Promise(function (resolve, reject) {

                var messagingURL = getMessagingURL(config);

                //For durable subscriptions, the clientId has to be something "permanent" and
                //session cleaning has to be set to false.
                mqttClient = mqtt.connect(messagingURL,
                    {
                        "keepalive": 0,
                        "clean": false,
                        "clientId": getClientId(config)
                    });

                mqttClient.on('connect', function () {
                    logger.debug('MQTT messaging client connected', messagingURL);
                    resolve();
                });

                mqttClient.on('error', function (err) {
                    logger.warn('MQTT messaging client connection error', err);
                    reject(err);
                });
            });
        } else {
            logger.debug('existing connection promise used');
        }

        return connectionPromise;
    }


    function isConnected() {
        if (!mqttClient) {
            return false;
        }
        return mqttClient.connected;
    }


    function publish(topic, message) {

        if (isConnected()) {
            mqttClient.publish(topic, message, {qos: 2}, function () {
                logger.debug('MQTT messaging client published (existing connection)', topic, message);
            });
        } else {
            connect().then(
                function () {
                    mqttClient.publish(topic, message, {qos: 2}, function () {
                        logger.debug('MQTT messaging client published (reconnection)', topic, message);
                    });
                },
                function (err) {
                    logger.debug('MQTT client could not publish', topic, message, err);
                }
            );

        }
    }

    function subscribe(patterns) {

        var subscriptionPatterns = patterns || ['services/#', 'events/#'];

        if (isConnected()) {
            mqttClient.subscribe(subscriptionPatterns, {qos: 2}, function (subErr, granted) {
                if (subErr) {
                    logger.error('MQTT messaging client subscriptions error', subscriptionPatterns, subErr);
                    return;
                }
                logger.debug('MQTT messaging client subscriptions granted', subscriptionPatterns, granted);
            });
        } else {
            connect().then(
                function () {
                    mqttClient.subscribe(subscriptionPatterns, {qos: 2}, function (subErr, granted) {
                        if (subErr) {
                            logger.error('MQTT messaging client subscriptions error', subscriptionPatterns, subErr);
                            return;
                        }
                        logger.debug('MQTT messaging client subscriptions granted', subscriptionPatterns, granted);
                    });
                },
                function (connErr) {
                    logger.debug('MQTT client could not subscribe', subscriptionPatterns, connErr);
                }
            );

        }
    }

    function getEventSource() {
        return mqttClient;
    }

    return {
        connect: connect,
        isConnected: isConnected,
        publish: publish,
        subscribe: subscribe,
        getEventSource: getEventSource
    };

}

/**
* Constructs and returns a redis client object.
*
* @returns {Object} Client c
*/
function getRedisClient(messagesURL, cb) {
    var redisClient = new Redis(messagesURL);

    function handleConnect() {
        var logger = require('./loggers').getLogger();
        logger.info('redis client connected', messagesURL);
    }

    redisClient.on('connect', handleConnect);

    function handleReady() {
        var logger = require('./loggers').getLogger();
        logger.debug('redis client ready', messagesURL);
        redisClient.connected = true;
        cb(null, redisClient);
    }

    redisClient.on('ready', handleReady);

    function handleClose() {
        var logger = require('./loggers').getLogger();
        logger.debug('redis client closed', messagesURL);
    }

    redisClient.on('close', handleClose);
}
module.exports.getRedisClient = getRedisClient;

/**
 * Returns a Promise that resolves when the messaging client has been
 * successfully connected.
 *
 * @returns Promise
 */
function connectClient() {

    var logger = require('./loggers').getLogger();

    logger.debug('connectClient() called');

    if (connectClientPromise) {
        logger.debug('returning existing connectClientPromise');
        return connectClientPromise;
    }

    connectClientPromise = new Promise(function (resolve, reject) {

        messagingClient.connect().then(
            function () {
                logger.debug('returning connected messaging client');
                resolve();
            },
            function (err) {
                logger.warn('could not get a connected messaging client', err);
                reject(err);
            }
        );
    });

    return connectClientPromise;
}


/**
 * The constructor/init function called when the module is 'required'.  It expects
 * a service configuration and returns a messaging client that can publish and/or
 * subscribe to messages from the message service. The appropriate type of messaging
 * client is created as dictated in the configuration.
 *
 * Note that the client is not yet connected.  To use the messaging client safely
 *
 * @param cfg                  The full service configuration.
 * @param cfg.messages         The messaging section of the service configuration.
 * @param cfg.messages.scheme  The messaging protocol to use (log, tcp, redis).
 * @param cfg.messages.host    The hostname of the message queue.
 * @param cfg.messages.port    The port of the message queue.

 * @returns {Object} A messaging client.
 */
module.exports = function (cfg) {

    var logger = require('./loggers').getLogger();
    config = cfg || require('./config');

    logger.debug('messaging configuration', config.messages);

    if (config.messages.scheme === 'tcp') {
        messagingClient = createMQTTClient(config);
    }

    if (!messagingClient) {
        messagingClient = createLoggingClient(config);
    }

    //Add the various utility methods to the client.
    messagingClient.connectClient = connectClient;
    messagingClient.createEvent = createEvent;
    messagingClient.createEventFromBarrel = createEventFromBarrel;
    messagingClient.publishMessage = publishMessage;
    messagingClient.publishServiceEvent = publishServiceEvent;
    messagingClient.publishServiceEventFromBarrel = publishServiceEventFromBarrel;
    messagingClient.saveEventToDB = saveEventToDB;

    return messagingClient;

};