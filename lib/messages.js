var config = require('./config');
var mqtt = require('mqtt');
var ld = require('lodash');

var messagesURL = config.messages.scheme + '://' + config.messages.host + ':' + config.messages.port;
var client = mqtt.connect(messagesURL);
console.log('message client URL', messagesURL);

client.on('connect', function () {
    console.log('messages client connected', messagesURL);
});

client.on('reconnect', function () {
    console.log('messages client reconnected', messagesURL);
});

client.on('close', function () {
    console.log('messages client disconnected', messagesURL);
});

client.on('error', function (err) {
    console.log('messages client error', err);
});

client.on('message', function (topic, message, packet) {
    console.log('messages client message', topic, message, packet);
});


function publish(topic, message) {

    console.log('publish request', topic, message);

    if (!topic || !ld.isString(topic)) {
        console.log('topic must be a string (e.g. services/docs/create)', topic);
        return;
    }

    if (!message || (!ld.isString(message) && !ld.isObject(message))) {
        console.log('message must be a JSON string', message);
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
            console.log('cannot JSON.stringify message', message);
            return;
        }
    }

    console.log('publishing', ', connected =', client.connected, ', topic =', topic, ', message =', safeMessage);
    client.publish(topic, safeMessage, function () {
        console.log('published', topic, safeMessage);
    });
}
module.exports.publish = publish;
