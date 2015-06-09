var config = require('./config');
var mqtt = require('mqtt');

var messagesURL = config.messages.scheme + '://' + config.messages.host + ':' + config.messages.port;
var client  = mqtt.connect(messagesURL);
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


function publish(topic, message){
    console.log('publish called', topic, message);
    console.log('publish client connected', client.connected);
    client.publish(topic, message, function(){
        console.log('published', topic, message);
    });
}
module.exports.publish = publish;
