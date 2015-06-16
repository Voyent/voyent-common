var config = require('./config');
var mqtt = require('mqtt');
var ld = require('lodash');

function getMQTTCLient() {
    var messagesURL = config.messages.scheme + '://' + config.messages.host + ':' + config.messages.port;
    var mqttClient = mqtt.connect(messagesURL);

    function handleConnect() {
        var logger = require('./loggers').getLogger();
        logger.info('mqtt client connected', messagesURL);
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

    function handleMessage(topic, message, packet) {
        var logger = require('./loggers').getLogger();
        logger.debug('mqtt client message', topic, message, packet);
    }

    mqttClient.on('message', handleMessage);

    return mqttClient;
}

function getLogClient() {

    var logger = require('./loggers').getLogger();
    logger.info('creating log based messaging publisher');

    return {
        connected: true,
        publish: function (topic, message, cb) {
            logger.info('events being published via log client', topic, message);
            cb();
        }
    };
}

var msgClient = null;
if (config.messages.scheme === 'tcp') {
    msgClient = getMQTTCLient();
}

if (config.messages.scheme === 'log') {
    msgClient = getLogClient();
}


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
    if (barrel.req.headers.host) {
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

    logger.debug('publishing', ', connected =', msgClient.connected, ', topic =', topic, ', message =', safeMessage);

    if (msgClient.connected) {
        msgClient.publish(topic, safeMessage, function () {
            logger.debug('published', topic, safeMessage);
        });
    } else {
        logger.warn('mqtt client not connected, cannot send message', topic, safeMessage);
    }
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
