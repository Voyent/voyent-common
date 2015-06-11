var config = require('./config');
var db = require('./db');

function saveEvent(barrel) {
    var logger = require('./loggers').getLogger();

    logger.debug('saving service event');

    if (!barrel.serviceEvent || !barrel.serviceResource) {
        logger.debug('could not save event, missing required properties');
        return;
    }

    var event = setupEvent(barrel);
    getEventsCollection(barrel);
    var coll = barrel.eventsCollection;
    if (!coll) {
        return;
    }

    coll.insert(event, {w: 1}, function (err, doc) {
        if (err) {
            logger.error('could not save event', err);
            return;
        }
        logger.debug('succesfully saved event',doc);
    });
}
module.exports.saveEvent = saveEvent;

function getEventsCollection(barrel) {
    var logger = require('./loggers').getLogger();

    var collectionName = 'events';

    logger.debug('getting events collection: ' + barrel.accountId + ' -> ' + barrel.realmId + '.' + collectionName);

    db.getCollection(barrel.accountId, barrel.realmId, collectionName, function (err, coll) {
        if (err) {
            logger.error('could not get events collection: ' + barrel.accountId + ' -> ' + barrel.realmId + '.' + collectionName, err);
            return;
        }
        barrel.eventsCollection = coll;
    });
}

function setupEvent(barrel) {
    var now = new Date();

    var event = {
        "time": now.toISOString(),
        "account": barrel.account ? barrel.account : barrel.accountId,
        "realm": barrel.realmId,
        "service": config.service.name,
        "resource": barrel.serviceResource,
        "event": barrel.serviceEvent,
        "username": barrel.username
    };

    event.data = barrel.serviceEventData ? barrel.serviceEventData : {};

    if (barrel.validatedResourceId || barrel.resourceId) {
        event.data.resourceId = barrel.validatedResourceId ? barrel.validatedResourceId : barrel.resourceId;
    }
    if (barrel.req.headers.host) {
        event.data.origin = barrel.req.headers.host;
    }
    if (barrel.startTime) {
        event.data.processTime = now.getTime() - barrel.startTime;
    }

    return event;
}