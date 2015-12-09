var config = require('./config');
var db = require('./db');

var ld = require('lodash');

var mqtt = require('mqtt');
var Redis = require('ioredis');


/**
 * Allow the logging message client to also save the events to the database.  This
 * would normally be done by the event hub or the listener responsible for processing
 * the events.  However, the logging message client doesn't broadcast anything so it
 * needs to do it.
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

    var newEvent  = {
        _data : event,
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
module.exports.saveEventToDB = saveEventToDB;


/**
 * Constructs and returns a messaging client that simply logs events rather
 * than try to publish them to a message broker.  This is suitable for when
 * a service is under development and you don't want to have to run the
 * entire infrastructure.  Events are still saved to the database.
 *
 * @returns {Object} Messaging client that logs event and saves them to the
 *                   database.
 */
function getLogClient() {

    var logger = require('./loggers').getLogger();
    logger.info('creating log based messaging publisher');

    return {
        connected: true,
        publish: function (topic, message, cb) {
            logger.info('events being published via log client', topic, message);
            saveEventToDB(message);
            cb();
        }
    };
}


/**
 * Constructs and returns a messaging client that uses the MQTT protocol.
 *
 * @returns {Object} MQTT messaging client
 */
function getMQTTClient(messagesURL, cb) {
    var mqttClient = mqtt.connect(messagesURL,{"keepalive":0});

    function handleConnect() {
        var logger = require('./loggers').getLogger();
        logger.info('mqtt client connected', messagesURL);
        cb(null, mqttClient);
    }

    mqttClient.on('connect', handleConnect);

    function handleReconnect() {
        var logger = require('./loggers').getLogger();
        logger.debug('mqtt client reconnected', messagesURL);
    }

    mqttClient.on('reconnect', handleReconnect);

    function handleClose() {
        var logger = require('./loggers').getLogger();
        logger.debug('mqtt client closed', messagesURL);
    }

    mqttClient.on('close', handleClose);

    function handleError(err) {
        var logger = require('./loggers').getLogger();
        logger.warn('mqtt client error', err);
    }

    mqttClient.on('error', handleError);
}

/**
 * Constructs and returns a messaging client that uses the MQTT protocol.
 *
 * @returns {Object} MQTT messaging client
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


var messagingClient;

//Determine and get a messaging client based on the config.messages.scheme
function getMessagingClient(customConfig, cb) {

    //If there's already a client created, use that.
    if (messagingClient) {
        cb(null, messagingClient);
        return;
    }

    var logger = require('./loggers').getLogger();

    var cfg = customConfig || config;

    var messagesURL = cfg.messages.scheme + '://' + cfg.messages.host + ':' + cfg.messages.port;
    if(config.env.hosts && config.env.hosts.msgs){
        messagesURL = cfg.messages.scheme + '://' + config.env.hosts.msgs;
    }
    logger.debug('messaging client URL', messagesURL);

    if (config.messages.scheme === 'log') {
        messagingClient = getLogClient();
        cb(null, messagingClient);
        return;
    }

    if (config.messages.scheme === 'tcp') {
        getMQTTClient(messagesURL, function (err, client) {
            if (err) {
                logger.warn('problem getting MQTT messaging client', messagesURL);
                cb(err);
                return;
            }
            messagingClient = client;
            cb(null, messagingClient);
            return;
        });
    }

    if (config.messages.scheme === 'redis') {
        getRedisClient(messagesURL, function (err, client) {
            if (err) {
                logger.warn('problem getting Redis messaging client', messagesURL);
                cb(err);
                return;
            }
            messagingClient = client;
            cb(null, messagingClient);
            return;
        });
    }

}
module.exports.getMessagingClient = getMessagingClient;


/**
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
module.exports.createEvent = createEvent;

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
module.exports.createEventFromBarrel = createEventFromBarrel;


/**
 * Publishes a message to the specified topic.
 *
 * @param topic {String} A hierarchical topic string that follows a set pattern
 *                       (e.g. services/myaccount/myrealm/docs/create).
 * @param message {String} The message to publish.  If an Object is provided, it
 *                         will be converted to a String.
 *
 */
function publishMessage(topic, message) {

    var logger = require('./loggers').getLogger();
    logger.debug('publishing request', topic, message);

    if (!topic || !ld.isString(topic)) {
        logger.warn('topic must be a string (e.g. services/myaccount/myrealm/docs/create)', topic);
        return;
    }

    if (!message || (!ld.isString(message) && !ld.isObject(message))) {
        logger.warn('message must be a string or an object that can be converted to a String', message);
        return;
    }

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
            return;
        }
    }

    getMessagingClient(null, function (err, msgClient) {

        if(err){
            logger.warn('could not get messaging client', err);
            return;
        }

        logger.debug('publishing', ', connected =', msgClient.connected, ', topic =', topic, ', message =', safeMessage);

        if (msgClient.connected) {
            msgClient.publish(topic, safeMessage, function () {
                logger.debug('published', topic, safeMessage);
            });
        } else {
            logger.warn('messaging client not connected, cannot send message', topic, safeMessage);
        }
    });
}
module.exports.publishMessage = publishMessage;


/**
 * Convenience method for publishing a service event.  For details of required and optional properties
 * of the event, see createEvent().
 *
 * @param event
 */
function publishServiceEvent(event) {
    var topic = 'services/' + event.account + '/' + event.realm + '/' + event.service + '/' + event.event;
    publishMessage(topic, event);
}
module.exports.publishServiceEvent = publishServiceEvent;


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
module.exports.publishServiceEventFromBarrel = publishServiceEventFromBarrel;
