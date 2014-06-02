var config = require('../lib/config');
var logger = require('../lib/loggers').getLogger(config.logging.defaults);

var title = 'Loggers';

describe(title, function () {

//    before(function (done) {
//        console.log('logger: ' + logger);
//        done();
//    });

    describe('Error', function () {
        it('logs to error level', function (done) {
            logger.error('test error');
            done();
        });
    });

    describe('Warn', function () {
        it('logs to warn level', function (done) {
            logger.warn('test warn');
            done();
        });
    });

    describe('Info', function () {
        it('logs to info level', function (done) {
            logger.info('test info');
            done();
        });
    });

    describe('Debug', function () {
        it('logs to debug level', function (done) {
            logger.debug('test debug');
            done();
        });
    });

});


