var config = require('./config');
var httpClient = require('request');

/**
 * A common requirement for a service is send metrics information to the Metric service.
 *
 * @params access_token The current access_token for the request
 * @params realm The Realm name
 * @params service Name of the service the metric is associated with
 * @params metric The actual metric information payload
 * @params type The logical type of the metric payload (e.g. location)
 * @params callback The async callback with the result of the metrics submission
 */
function sendMetric(token, realm, service, metricData, metricType, cb) {

    //In order to have modules respect the logging configuration supplied by the service, we
    //need to get the logger in a 'lazy' fashion.  If we get it during initialization, then
    //the logger instance only has the default configuration.
    var logger = require('./loggers').getLogger();

    //If you want to run your service without actually sending metrics to a Metrics service, you
    //can disable it during development.
    if (!config.metrics.enabled) {
        logger.warn('[config.metrics.enabled = ' + config.metrics.enabled + ']',
            '** Metrics has been disabled for development. It should be re-enabled in a production environment. **');
        cb(null, {msg: 'permission(s) granted', username: 'developmentUser'});
        return;
    }

    logger.debug('sendMetric:' +
        '\n  access_token: ' + token +
        '\n  realm: ' + realm +
        '\n  service: ' + service +
        '\n  data: ' + metricData +
        '\n  type: ' + metricType
    );

    var errorMessage;

    if (!token) {
        errorMessage = 'missing access_token';
    } else if (!realm) {
        errorMessage = 'missing realm';
    } else if (!service) {
        errorMessage = 'missing service';
    } else if (!metricData) {
        errorMessage = 'missing service';
    } else if (!metricType) {
        errorMessage = 'missing service';
    }

    if (errorMessage) {
        logger.error(errorMessage);
        callback(errorMessage);
        return;
    }

    //Prepend realm to type so that data is stored in a realm specific collection (. not allowed so use _ instead)
    var collection = realm.split(".").join("_") + "_" + service;
    var content = {
        "access_token": token,
        "type": collection,
        "time": new Date(),
        "data": {
            "content": metricData,
            "postType": metricType
        }
    };

    // Set our options, such as where to POST to
    var options = {
        uri: config.metrics.url + realm + "/stats",
        body: JSON.stringify(content),
        headers: { 'Content-type': 'application/json' }
    };

    logger.info("posting metrics: " + JSON.stringify(options));

    // Use "request" library to POST
    httpClient.post(options, function (err, response, body) {

        if (err) {
            logger.error(errorMessage);
            callback(err);
            return;
        }

        callback(null, body);
    });
}
exports.sendMetric = sendMetric;