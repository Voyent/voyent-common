var config = require('./config');
var auth = require('./authCall');
var httpClient = require('request');
var EventEmitter = require('events').EventEmitter;
var emitter = new EventEmitter();

function addMetricsListener(eventNames) {
    if (!eventNames) {
        return;
    }

    for (var i = 0; i < eventNames.length; i++) {
        var en = eventNames[i];
        emitter.addListener(en, sendToMetricsService);
    }
}
module.exports.addMetricsListener = addMetricsListener;


function emitEvent(eventName, eventInfo) {
    emitter.emit(eventName, eventInfo);
}
module.exports.emitEvent = emitEvent;


function emitDefaultMetricEvent(barrel) {

    //In order to have modules respect the logging configuration supplied by the service, we
    //need to get the logger in a 'lazy' fashion.  If we get it during initialization, then
    //the logger instance only has the default configuration.
    var logger = require('./loggers').getLogger();

    //If service credentials are provided, send them along as well.
    if (barrel.serviceCredentials) {
        auth.getServiceToken(barrel.serviceCredentials, function (err, serviceToken) {
            if (err) {
                logger.warn('could not get service token', err);
                return;
            } else {
                barrel.agent = {access_token: serviceToken, realm: 'bridgeit.services', type: config.service.name};
            }
            emitMetricEvent(barrel.permission, getBaseMetric(barrel));
        });

    } else {
        emitMetricEvent(barrel.permission, getBaseMetric(barrel));
    }
}
module.exports.emitDefaultMetricEvent = emitDefaultMetricEvent;


function emitMetricEvent(metricName, metricRecord) {
    emitter.emit(metricName, metricRecord);
}
module.exports.emitMetricEvent = emitMetricEvent;


function getBaseMetric(barrel) {

    var now = new Date();

    //Top-level properties are used by other services but not stored as part of the metric. For
    //anything that needs to be included in the metric, it should be stored in the data sub-document
    //as below.
    var eventInfo = {
        auth: {
            user: {
                realm: barrel.realmId
            }
        }
    };

    if (barrel.agent) {
        eventInfo.auth.agent = barrel.agent;
    }

    //Anything important to be stored as a metric should be included in the data section.
    var data = {
        event_time: now.toISOString(),
        account: barrel.account,
        realm: barrel.realmId,
        service: config.service.name,
        username: barrel.permissionCheck.username,
        op: barrel.req.method
    };

    if (barrel.req.headers['content-length']) {
        data.docSize = barrel.req.headers['content-length'];
    } else if (barrel.req.connection.bytesRead) {
        data.docSize = barrel.req.connection.bytesRead;
    }

    if (barrel.validatedResource && barrel.validatedResource._id) {
        data.resourceId = barrel.validatedResource._id;
    }

    if (barrel.req.headers.host) {
        data.origin = barrel.req.headers.host;
    }

    if (barrel.startTime) {
        data.elapsed = now.getTime() - barrel.startTime;
    }

    eventInfo.data = data;
    return eventInfo;
}
module.exports.getBaseMetric = getBaseMetric;


/**
 * A common requirement for a service is send metrics information to the Metric service.
 *
 * @params realm The name of the realm this metric belongs to
 * @params username The username of the person that generated the metric data
 * @params serviceName The name of the service that triggered the metric
 * @params metricData The specific data payload of the metric
 */
function sendToMetricsService(record) {

    //In order to have modules respect the logging configuration supplied by the service, we
    //need to get the logger in a 'lazy' fashion.  If we get it during initialization, then
    //the logger instance only has the default configuration.
    var logger = require('./loggers').getLogger();

    // Set our options, such as where to POST to
    var options = {
        uri: config.metrics.url + '/' + record.data.realm + '/stats',
        body: JSON.stringify(record),
        headers: { 'Content-type': 'application/json' }
    };

    logger.debug('sending to Metrics service: ' + JSON.stringify(options, null, 4));

    //If you want to run your service without actually sending metrics to a Metrics service, you
    //can disable it during development.
    if (!config.metrics.enabled) {
        logger.warn('[config.metrics.enabled = ' + config.metrics.enabled + ']',
            '** Metrics has been disabled for development. It should be re-enabled in a production environment. **');
        return;
    }

    // Use "request" library to POST
    httpClient.post(options, function (err, response, body) {

        if (err) {
            logger.error('problem sending metrics: ' + err);
        }

    });
}
module.exports.sendToMetricsService = sendToMetricsService;