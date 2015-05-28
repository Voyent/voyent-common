var config = require('./config');
var db = require('./db');

function saveEvent(barrel) {
    var logger = require('./loggers').getLogger();
    var now = new Date();

    logger.debug('saving service event');

    if (!barrel.username || !barrel.serviceEvent) {
        logger.debug('could not save event, username or serviceEvent not provided');
        return;
    }

    if (barrel.resourceId) {
        if (!barrel.serviceEventData) {
            barrel.serviceEventData = {};
        }
        barrel.serviceEventData.resourceId = barrel.resourceId
    }

    var event = {
        "service": config.service.name,
        "event": barrel.serviceEvent,
        "time": now.toISOString(),
        "username": barrel.username,
    };
    if (barrel.serviceEventData) {
        event.data = barrel.serviceEventData;
    }

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