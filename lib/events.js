var db = require('./db');
var ld = require('lodash');
var mqtt = require('mqtt');
var Rx = require('rx');
var tools = require('./tools');

var config;
var connectClientPromise;
var messagingClient;
var subscriptionObservable;

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

        coll.insertOne(newEvent, {w: 1}, function (err, result) {

            if (err) {
                logger.error('could not save event', err);
                return;
            }

            logger.debug('successfully saved event', newEvent);
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
    } else {
        logger.error ("Invalid topic ", isValidTopic(topic), 'or message', isValidMessage(message));
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
 * @param time {String}     Custom date/time represented in ISO 8601 UTC format (YYYY-MM-DDTHH:mm:ss.sssZ), if not provided the current time will be used. Optional.
 * @param txcode {String}   The relevant request transaction code. Optional.
 * @returns {Object}        A standard event object created from the parameters.
 */
function createEvent(account, realm, service, event, type, username, data, time, txcode) {

    var logger = require('./loggers').getLogger();

    if (arguments.length < 6 || arguments.length > 9) {
        logger.warn('could not create event, should have 6-9 arguments', arguments.length);
        return null;
    }

    var officialEvent = {
        "time": time ? time : new Date().toISOString(),
        "account": account,
        "realm": realm,
        "service": service,
        "event": event,
        "type": type,
        "username": username
    };

    if (txcode) {
        officialEvent.tx = txcode;
    }

    officialEvent.data = data || {};

    return officialEvent;
}

/**
 * A barrel typically contains all the information required to create an event so
 * this function is a convenience that pulls the relevant info and then calls through
 * to createEvent(account, realm, service, event, type, username, data, time, tx).
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

    var theEvent = createEvent(
        account,
        barrel.realmId,
        config.service.name,
        barrel.serviceEvent,
        barrel.resourceType,
        barrel.username,
        customData,
        null,
        barrel.meta && barrel.meta.tx ? barrel.meta.tx : null
    );

    var processId = tools.getProcessId(barrel.req);
    if(processId){
        theEvent.processId = processId;
    }

    return theEvent;
}

/**
 * A barrel typically contains all the information required to create an event so
 * this function is a convenience that pulls the relevant info and then calls through
 * to createEvent(account, realm, service, event, type, username, data, time, tx).
 * This function focuses on grabbing data from a validated resource in the barrel.
 *
 * @param barrel {Object}  The general container for all properties carried through a
 *                         services waterfall of functions.
 * @returns {Object}       A standard event object created from the barrel.
 */
function createCustomEventFromBarrel(barrel) {

    var logger = require('./loggers').getLogger();
    logger.debug('creating custom event from validatedResource in barrel');

    //First check to see if barrel is missing any required information.
    var paramErrors = [];
    if (!barrel.account && !barrel.accountId) {
        paramErrors.push('barrel.account or barrel.accountId');
    }

    if (!barrel.realmId) {
        paramErrors.push('barrel.realmId');
    }

    if (!barrel.validatedResource.service) {
        paramErrors.push('barrel.validatedResource.service');
    }

    if (!barrel.validatedResource.event) {
        paramErrors.push('barrel.validatedResource.event');
    }

    if (!barrel.validatedResource.type) {
        paramErrors.push('barrel.validatedResource.type');
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

    var customData = barrel.validatedResource.data || {};

    if (barrel.req && barrel.req.headers && barrel.req.headers.host) {
        customData.origin = barrel.req.headers.host;
    }
    if (barrel.startTime) {
        customData.processTime = new Date().getTime() - barrel.startTime;
    }

    var theEvent = createEvent(
        account,
        barrel.realmId,
        barrel.validatedResource.service,
        barrel.validatedResource.event,
        barrel.validatedResource.type,
        barrel.username,
        customData,
        barrel.validatedResource.time ? barrel.validatedResource.time : new Date().toISOString(),
        barrel.meta && barrel.meta.tx ? barrel.meta.tx : null);

    var processId = tools.getProcessId(barrel.req);
    if(processId){
        theEvent.processId = processId;
    }

    return theEvent;
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
 * Convenience method for publishing a service event based a validated resource in a barrel. For details
 * of required and optional properties of the event, see createEvent().
 *
 * @param barrel
 */
function publishCustomEventFromBarrel(barrel) {
    var event = createCustomEventFromBarrel(barrel);
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
 * Convenience method for connecting the messaging client and subscribing to a topic
 * URL. After successful connection we return an RX Observable to the callback.
 *
 * @param topic
 * @param cb(Rx.Observable)
 */
function connectAndSubscribe(topic,cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('connectAndSubscribe() called');

    if (!isValidTopic(topic)) {
        cb(null);
        return;
    }

    //Connect the messaging client
    connectClient().then(
        function () {

            //Only set up the Observable once
            if (subscriptionObservable) {
                logger.debug('returning existing subscriptionObservable');
                cb(subscriptionObservable);
                return;
            }

            //Subscribe to topic
            messagingClient.subscribe(topic);

            //Wrap up the "on message" event emitter as an Observable. This 
            //observes all incoming events without any filters applied.
            subscriptionObservable = Rx.Observable.fromEvent(
                messagingClient.getEventSource(),
                'message',
                function (args) {
                    //The payload comes in as a Buffer so we convert to a String and then parse it.
                    var parsedMessage;
                    try {
                        parsedMessage = JSON.parse(args[1].toString());
                        logger.debug('New Event Received', '\n  topic->', args[0], '\n  message->', JSON.stringify(parsedMessage, null, 4));
                    }
                    catch(e) {
                        parsedMessage = args[1];
                    }
                    //Name the arguments we are expecting from the MQTT broker
                    return {topic: args[0], message: parsedMessage, packet: args[2]};
                }
            );
            logger.debug('returning subscribed observable');
            cb(subscriptionObservable);
        }
    );
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
    messagingClient.connectAndSubscribe = connectAndSubscribe;
    messagingClient.createEvent = createEvent;
    messagingClient.createEventFromBarrel = createEventFromBarrel;
    messagingClient.publishMessage = publishMessage;
    messagingClient.publishServiceEvent = publishServiceEvent;
    messagingClient.publishServiceEventFromBarrel = publishServiceEventFromBarrel;
    messagingClient.publishCustomEventFromBarrel = publishCustomEventFromBarrel;
    messagingClient.createCustomEventFromBarrel = createCustomEventFromBarrel;
    messagingClient.saveEventToDB = saveEventToDB;

    return messagingClient;

};