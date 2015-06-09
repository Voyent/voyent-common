var assert = require('assert');
var messages = require('../lib/messages');

describe('Messages', function () {

    it('publish', function (done) {
        assert(messages);
        messages.publish('services/test/publishMessage', 'Test message @ ' + new Date().toISOString());
        setTimeout(function () {
            done();
        }, 1000);

    });

});

