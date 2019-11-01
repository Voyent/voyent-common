/*
 * ICESOFT COMMERCIAL SOURCE CODE LICENSE V 1.1
 *
 * The contents of this file are subject to the ICEsoft Commercial Source
 * Code License Agreement V1.1 (the "License"); you may not use this file
 * except in compliance with the License. You may obtain a copy of the
 * License at
 * http://www.icesoft.com/license/commercial-source-v1.1.html
 *
 * Software distributed under the License is distributed on an "AS IS"
 * basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the
 * License for the specific language governing rights and limitations under
 * the License.
 *
 * Copyright 2009-2014 ICEsoft Technologies Canada, Corp. All Rights Reserved.
 */

const vc = require('voyent-common')();
const logger = vc.loggers.getLogger();
const aws = vc.awsCommon;
const db = vc.db;
const scopes = vc.scopes;
const errors = vc.errors;

const async = require('async');
const ld = require("lodash");
const uuid = require('uuid');
const moment = require('moment-timezone');
const hasher = require('node-object-hash')();


const CLOUD_PROTOCOLS = [
    'apns',
    'fcm',
    'mailto',
    'sms',
    'voice',
    'vras'
];


function getRealmInfoForAccount(account, realm, cb) {

    let scopeId = '_realm_' + realm;

    scopes.getScope(account, realm, scopeId)
        .then(function (scope) {

            scope.getAttribute('realmInfo')
                .then(function (realmInfo) {
                    cb(null, realmInfo);
                }, function (err) {
                    logger.error('problem getting realm info', account, realm);
                    return cb(err);
                });

        }, function (err) {
            logger.error('problem getting realm scope', account, realm);
            cb(err);
        });
}


function getTimezoneCode(realmInfo) {
    let tz = ld.get(realmInfo, 'timezone');
    if (!tz) {
        return;
    }
    let tzCode = moment.tz(tz);
    if (!tzCode) {
        return;
    }
    return tzCode.format('z');
}

function getTimezoneOffset(realmInfo) {
    let tz = ld.get(realmInfo, 'timezone');
    if (!tz) {
        return;
    }
    const tzZone = moment.tz.zone(tz);
    if (!tzZone) {
        return 0;
    }
    return tzZone.utcOffset(Date.now());
}

/**
 *
 * @param params
 * @param params.batchId
 * @param params.messageHash
 * @param params.notificationEndpoint
 * @param params.notificationType
 * @param params.priority
 * @param params.priorityLevel
 * @param params.time
 * @param params.username
 */
function buildNotificationLog(params) {

    // logger.debug('buildNotificationLog', JSON.stringify(params));

    return {
        _id: uuid.v4(),
        batchId: params.batchId,
        messageHash: params.messageHash,
        notificationEndpoint: params.notificationEndpoint,
        priority: params.priority,
        priorityLevel: params.priorityLevel,
        time: params.time,
        notificationType: params.notificationType,
        username: params.username,
    };
}


function getProtocol(notificationEndpoint) {

    if (!notificationEndpoint) {
        logger.warn('cannot get protocol, no endpoint provided');
        return;
    }

    let protocol = notificationEndpoint.substring(0, notificationEndpoint.indexOf(':'))
        .trim()
        .toLowerCase();

    if (!protocol || ld.indexOf(CLOUD_PROTOCOLS, protocol) === -1) {
        logger.warn('unknown or unsupported protocol for', notificationEndpoint);
        return;
    }

    return protocol;
}


/**
 * Given an array of username/notificationEndpoints:
 *
 * [
 *     { username: xxx, notificationEndpoint: yyy, ...}
 * ]
 *
 * (along with the other required parameters), creates a notification log for
 * each one and saves them all to the database.  If a record also contains a
 * notification log id, then we update the existing notification log with the
 * batchId rather than create a new one.
 *
 * @param params
 * @param params.accountId
 * @param params.batchId
 * @param params.notification
 * @param params.notificationType
 * @param params.priority
 * @param params.priorityLevel
 * @param params.realmId
 * @param params.time
 * @param params.users [{username: String, notificationEndpoint: String}]
 * @param cb
 */
function processNotificationLogs(params, cb) {

    logger.debug('processNotificationLogs', params.accountId, params.realmId);

    if (!params.users) {
        logger.warn('no users to process');
        return cb();
    }

    let logParams = {
        notificationType: params.notificationType,
        priority: params.priority,
        priorityLevel: params.priorityLevel,
        messageHash: hasher.hash(params.notification),
        batchId: params.batchId,
        time: params.time,
    };

    //Create a new or update an existing notification log for each
    //username/notificationEndpoint entry. We exclude invalid ones and we also
    //sort them piles by determining if they also have an existing
    //notification log or not.

    let newLogs = [];
    let existingLogs = [];

    ld.each(params.users, function (user) {

        //Check the protocol of the endpoint to avoid creating a notification log
        //for bad ones.
        let protocol = getProtocol(user.notificationEndpoint);
        if (!protocol) {
            logger.warn('cannot create notification log for improper notification endpoint');
            return;
        }

        //If the user has an existing notification log id, we'll be updating
        //that by adding the batchId.  If they don't, we create a new log
        //record from scratch.
        if (user.notificationLogId) {
            user.nid = user.notificationLogId;
            existingLogs.push(user.notificationLogId);
        } else {
            logParams.username = user.username;
            logParams.notificationEndpoint = user.notificationEndpoint;
            let notificationLog = buildNotificationLog(logParams);
            user.nid = notificationLog._id;
            newLogs.push(notificationLog);
        }

    });

    let collName = 'action.notificationLog';

    db.getCollection(
        params.accountId,
        params.realmId,
        collName,
        function (err, coll) {

            if (err) {
                logger.error(
                    'processNotificationLogs',
                    'problem getting collection',
                    params.accountId,
                    params.realmId,
                    collName,
                    err.message
                );
                return cb(err);
            }

            //Create and/or update notification logs in parallel as necessary.
            async.parallel([

                function (acb) {
                    if (!ld.isEmpty(newLogs)) {
                        coll.insertMany(newLogs, acb);
                    } else {
                        acb();
                    }
                },

                function (acb) {
                    if (!ld.isEmpty(existingLogs)) {

                        let filter = {_id: {$in: existingLogs}};
                        let update = {$set: {batchId: params.batchId}};

                        coll.updateMany(filter, update, acb);
                    } else {
                        acb();
                    }
                }

            ], function (err) {

                if (err) {
                    return cb(err);
                }

                cb();

            });
        });
}

/**
 * Make adjustments necessary for 'apns:' endpoint notifications.
 *
 * @param notification
 * @param userInfo
 */
function adjustNotificationForAPNS(notification, userInfo) {

    if (userInfo.callbackURL) {
        ld.set(notification, 'global.url', userInfo.callbackURL);
    }

    if (userInfo.nid) {
        ld.set(notification, 'global.nid', userInfo.nid);
    }

    ld.set(notification, 'global.delay', ld.get(notification, 'apns.delay'));

    ld.unset(notification, 'apns');
    ld.unset(notification, 'cloud.body');
    ld.unset(notification, 'email');
    ld.unset(notification, 'fcm');
    ld.unset(notification, 'sms');
    ld.unset(notification, 'voice');

}


/**
 * Make adjustments necessary for 'fcm:' endpoint notifications.
 *
 * @param notification
 * @param userInfo
 */
function adjustNotificationForFCM(notification, userInfo) {

    //If this is a "command" notification, we don't have to do any of the
    //processing that we need to do with other general notifications.
    let commandNotification = ld.get(notification, 'cloud.commands');
    if (commandNotification) {
        return;
    }

    let body = ld.get(notification, 'cloud.detail') ||
        ld.get(notification, 'cloud.description') ||
        ld.get(notification, 'global.detail') ||
        ld.get(notification, 'global.description');

    let priority = ld.get(notification, 'cloud.priority') ||
        ld.get(notification, 'global.priority') ||
        'informational';

    ld.set(notification, 'cloud', {
        silent: true,
        fcm: {
            data: {
                title: ld.get(notification, 'global.subject'),
                body: body,
                priority: priority
            }
        }
    });

    if (ld.get(notification, 'fcm')) {
        ld.set(notification, 'cloud.fcm.data.priority', ld.get(notification, 'fcm.priority'));
        ld.set(notification, 'cloud.fcm.data.type', ld.get(notification, 'fcm.type'));
        ld.set(notification, 'cloud.fcm.data.url', ld.get(notification, 'global.url'));
    }

    if (userInfo.callbackURL) {
        ld.set(notification, 'global.url', userInfo.callbackURL);
        ld.set(notification, 'cloud.fcm.data.url', userInfo.callbackURL);
    }

    if (userInfo.nid) {
        ld.set(notification, 'cloud.fcm.data.nid', userInfo.nid);
    }

    ld.unset(notification, 'apns');
    ld.unset(notification, 'email');
    ld.unset(notification, 'fcm');
    ld.unset(notification, 'sms');
    ld.unset(notification, 'voice');
}


/**
 * Make adjustments necessary for 'mailto:' endpoint notifications.
 *
 * @param notification
 * @param userInfo
 */
function adjustNotificationForEmail(notification, userInfo) {

    ld.unset(notification, 'apns');
    ld.unset(notification, 'cloud');
    ld.unset(notification, 'fcm');
    ld.unset(notification, 'sms');
    ld.unset(notification, 'shareable');
    ld.unset(notification, 'voice');

    let contents = ld.get(notification, 'global.detail') || ld.get(notification, 'global.detail');
    if (contents && contents.indexOf('<html' >= 0)) {
        ld.set(notification, 'email.content_type', 'text/html');
    }
}


/**
 * Make adjustments necessary for 'sms:' endpoint notifications.
 *
 * @param notification
 * @param userInfo
 */
function adjustNotificationForSMS(notification, userInfo) {

    ld.unset(notification, 'apns');
    ld.unset(notification, 'cloud');
    ld.unset(notification, 'email');
    ld.unset(notification, 'fcm');
    ld.unset(notification, 'shareable');
    ld.unset(notification, 'voice');
}


/**
 * Make adjustments necessary for 'voice:' endpoint notifications.
 *
 * @param notification
 * @param userInfo
 */
function adjustNotificationForVoice(notification, userInfo) {

    ld.unset(notification, 'apns');
    ld.unset(notification, 'cloud');
    ld.unset(notification, 'email');
    ld.unset(notification, 'fcm');
    ld.unset(notification, 'shareable');
    ld.unset(notification, 'sms');
}


/**
 * Make adjustments necessary for 'vras:simulated' endpoint notifications.
 *
 * @param notification
 * @param userInfo
 */
function adjustNotificationForSimulated(notification, userInfo) {

    ld.unset(notification, 'cloud');
    ld.unset(notification, 'email');
    ld.unset(notification, 'shareable');
    ld.unset(notification, 'sms');
    ld.unset(notification, 'voice');
}


function parseEndpoint(endpoint) {

    let divider = endpoint.indexOf(':');
    if (divider < 0) {
        logger.warn('parseEndpoint', 'cannot find delimiter ":"', endpoint);
        return;
    }

    return {
        protocol: endpoint.substring(0, divider).trim().toLowerCase(),
        destination: endpoint.substring(divider + 1).trim()
    };
}

module.exports.parseEndpoint = parseEndpoint;

/**
 * Adjust the notification for the varying protocols. In each case we
 * want to send the smallest payload necessary.
 *
 * @param notification
 * @param userInfo
 */
function adjustNotificationForProtocol(notification, userInfo) {

    let parsedEndpoint = parseEndpoint(userInfo.notificationEndpoint);
    if (!parsedEndpoint) {
        logger.error('adjustNotificationForProtocol', 'could not parse endpoint', userInfo.notificationEndpoint);
        throw new Error('could not parse endpoint ' + JSON.stringify(userInfo.notificationEndpoint));
    }

    switch (parsedEndpoint.protocol) {
        case 'apns':
            adjustNotificationForAPNS(notification, userInfo);
            break;
        case 'fcm':
            adjustNotificationForFCM(notification, userInfo);
            break;
        case 'mailto':
            adjustNotificationForEmail(notification, userInfo);
            break;
        case 'sms':
            adjustNotificationForSMS(notification, userInfo);
            break;
        case 'voice':
            adjustNotificationForVoice(notification, userInfo);
            break;
        case 'vras':

            switch (parsedEndpoint.destination) {
                case 'apns_unknown':
                    adjustNotificationForAPNS(notification, userInfo);
                    break;
                case 'fcm_unknown':
                    adjustNotificationForFCM(notification, userInfo);
                    break;
                case 'simulated':
                    adjustNotificationForSimulated(notification, userInfo);
                    break;
                default:
                    throw new Error('unknown vras endpoint ' + parsedEndpoint.destination);
            }

            break;

        default:
            throw new Error('unknown protocol ' + JSON.stringify(userInfo));
    }

}


function buildMailboxPayload(params, userInfo) {

    let record = {
        batchId: params.batchId,
        for: [userInfo.username],
        message: params.notification
    };

    ld.set(record, 'message.group', userInfo.notificationEndpoint);
    ld.set(record, 'message.issuer', params.issuer);
    ld.set(record, 'message.time', params.time);
    ld.set(record, 'message.timezone', params.timezone);
    ld.set(record, 'message.timezoneCode', params.timezoneCode);
    ld.set(record, 'message.timezoneOffset', params.timezoneOffset);
    ld.set(record, 'message.badge', params.badge);

    if (!params.skipLogs) {
        ld.set(record, 'message.nid', userInfo.nid);
    }

    return record;
}


function buildCloudPayload(params, userInfo) {

    let record = params.notification;

    ld.set(record, 'batchId', params.batchId);
    ld.set(record, 'issuer', params.issuer);
    ld.set(record, 'notify_back_uri', userInfo.notificationEndpoint);
    ld.set(record, 'time', params.time);
    ld.set(record, 'timezone', params.timezone);
    ld.set(record, 'timezoneCode', params.timezoneCode);

    if (!params.skipLogs) {
        ld.set(record, 'notification_log_id', userInfo.nid);
    }

    return record;
}


function buildBroadcastPayload(params, userInfo) {

    let record = {
        payload: params.notification,
        batchId: params.batchId,
        groupId: userInfo.username
    };

    // Set some standard properties
    ld.set(record, 'payload.global.groupId', userInfo.username);
    ld.set(record, 'payload.global.issuer', params.issuer);
    ld.set(record, 'payload.global.timezone', params.timezone);
    ld.set(record, 'payload.global.timezoneCode', params.timezoneCode);
    ld.set(record, 'payload.global.timezoneOffset', params.timezoneOffset);
    ld.set(record, 'payload.global.time', params.time);

    if (!params.skipLogs) {
        ld.set(record, 'payload.global.nid', userInfo.nid);
    }

    // Unset some properties that we don't need
    ld.unset(record, 'payload.cloud');
    ld.unset(record, 'payload.sms');
    ld.unset(record, 'payload.email');
    ld.unset(record, 'payload.voice');
    ld.unset(record, 'priorityLevel');

    // Move all other top-level properties to the global section
    ld.forIn(record.payload, function(value, key) {
        if (key !== 'global') {
            ld.set(record, 'payload.global.'+key, value);
            ld.unset(record, key);
        }
    });

    return record;
}


function buildServicesPayloads(params, userInfo) {

    //Generate the payloads for the specified services.  If none are
    //provided, assume all of them.
    let payload = {};

    logger.debug(
        'buildServicesPayloads',
        'services are',
        params.services || 'none specified, default to all'
    );

    if (!params.services || params.services.indexOf('broadcast') >= 0) {
        payload.broadcast = buildBroadcastPayload(ld.cloneDeep(params), userInfo);
    }

    if (!params.services || params.services.indexOf('cloud') >= 0) {
        payload.cloud = buildCloudPayload(ld.cloneDeep(params), userInfo);
    }

    if (!params.services || params.services.indexOf('mailbox') >= 0) {
        payload.mailbox = buildMailboxPayload(ld.cloneDeep(params), userInfo);
    }

    // logger.debug('buildServicesPayloads', JSON.stringify(payload));

    return payload;

}


/**
 * Because the batch notification format for each service is slightly different
 * we create them separately to make it clearer and easier to maintain going
 * forward.
 *
 * @param params
 * @param params.accountId
 * @param params.batchId
 * @param params.displayName
 * @param params.issuer
 * @param params.notification
 * @param params.notificationType
 * @param params.priority
 * @param params.priorityLevel
 * @param params.realmId
 * @param params.services [String] - cloud, mailbox, broadcast
 * @param params.time
 * @param params.timezone
 * @param params.timezoneCode
 * @param params.timezoneOffset
 * @param params.users [{username: String, notificationEndpoint: String}]
 *
 * @returns {{broadcast: *, cloud: *, mailbox: *}}
 */
function buildNotificationPayloads(params) {

    //Set up the properties that are general for all the payloads.
    let payloadParams = {
        batchId: params.batchId,
        issuer: params.issuer,
        services: params.services,
        timezone: params.timezone,
        timezoneCode: params.timezoneCode,
        timezoneOffset: params.timezoneOffset,
        time: new Date().toISOString(),
        notificationType: params.notificationType,
        alertId: params.alertId,
        alertFamilyId: params.alertFamilyId,
        badge: params.badge,
        skipLogs: params.skipLogs
    };

    // logger.debug('buildNotificationPayloads', 'payloadParams', JSON.stringify(payloadParams));

    //Loop through each set of user information and generate the specific
    //notification for that user based on the protocol then use that to
    //generate all the service specific payloads we need.
    return ld.map(params.users, function (userInfo) {

        payloadParams.notification = ld.cloneDeep(params.notification);

        try {

            userInfo.notification =
                adjustNotificationForProtocol(
                    payloadParams.notification,
                    userInfo
                );

            return buildServicesPayloads(payloadParams, userInfo);

        } catch (e) {
            logger.error(e.message);
        }

    });
}


function saveNotificationPayload(params, payload, serviceName, cb) {

    // logger.debug('saveNotificationPayload', serviceName, JSON.stringify(payload));

    let collName = serviceName + '.batch';

    db.getCollection(
        params.accountId,
        params.realmId,
        collName,
        function (err, coll) {

            if (err) {
                logger.error(
                    'problem getting batch collection',
                    params.accountId,
                    params.realmId,
                    collName,
                    err.message
                );
                return cb(err);
            }

            coll.insertMany(payload, function (err) {

                if (err) {
                    logger.error(
                        'problem inserting batch notifications',
                        coll.namespace,
                        err.message
                    );
                    return cb(err);
                }

                cb();
            });

        });
}


function saveNotificationPayloads(params, cb) {

    logger.debug('saveNotificationPayloads', params.payloads.length);

    //The payloads are organized by user, but to store them in the database,
    //we want them organized by service.  So we need to do some processing here
    //to reorganize them.
    let servicePayloads = {};

    //Loop through each user payload.
    ld.each(params.payloads, function (userPayload) {

        // logger.debug('saveNotificationPayloads', Object.keys(userPayload));

        //For each user payload, put it into the appropriate service bucket
        ld.each(userPayload, function (payload, serviceName) {

            if (!servicePayloads[serviceName]) {
                servicePayloads[serviceName] = [];
            }

            servicePayloads[serviceName].push(payload);

            // logger.debug('saveNotificationPayloads', serviceName, Object.keys(servicePayloads));

        });

    });

    // logger.debug('saveNotificationPayloads', JSON.stringify(servicePayloads));

    async.eachOf(servicePayloads, function (servicePayload, serviceName, acb) {
        saveNotificationPayload(params, servicePayload, serviceName, acb);
    }, function (err) {
        cb(err);
    });
}


function sendBatchEvent(params, cb) {

    logger.debug('sendBatchEvent', JSON.stringify(Object.keys(params)));

    let event = aws.createEvent(
        params.accountId,
        params.realmId,
        "action",
        "batch",
        "notifications",
        params.username,
        {batchId: params.batchId},
        (new Date()).toISOString(),
        ld.get(params, 'meta.tx')
    );

    logger.debug('sendBatchEvent', JSON.stringify(event));

    aws.publishServiceEvent(event);

    cb();
}


/**
 * This function is designed to request a notification using a consistent "batch"
 * approach. While it can accept one or more users, it accepts only a single
 * notification that has already been processed to insert any template variables.
 * The notification itself cannot contain any user specific information.  The
 * general strategy is:
 *
 * - Create a notification log for each user and save it to the database.
 *
 * - Build the payloads for each service that should get the notification.  This
 *   includes any combination of broadcast, cloud, and or mailbox.
 *
 * - Save those payloads to the appropriate database collections.
 *
 * - Send a "batch" event that includes the batchId for this request.  The event
 *   is used by the destination services to get the payloads from the database
 *   that match that batchId and process them accordingly.
 *
 * @param params
 *
 * @param {string} params.accountId - The account for these notifications.
 *
 * @param {Object} params.notification - The fully processed notification going
 *                                       to all of the provided users. Any
 *                                       customization or template values must
 *                                       have already been resolved.
 *
 * @param {string} [params.priority=informational] - The priority for this
 *                                                   notification.  This is
 *                                                   optional.  The default is
 *                                                   "informational" but can also
 *                                                   be set to "critical".
 *
 * @param {number} [params.priorityLevel=10] - A number indicating the priority
 *                                             of the message. This is optional
 *                                             and defaults to 10.
 *                                             10 = informational
 *                                             20 = critical
 *                                             30 = immediate
 *
 * @param {string} params.regionId - The region for these notifications.
 *
 * @param {string[]} [params.services=[broadscast, cloud, mailbox]]
 *              params.services - An array of one or more of strings indicating
 *                                the services that should be included.  If
 *                                nothing is provided, it default to all of them.
 *                                But you can specify any or all of the following:
 *                                [broadcast, cloud, mailbox]
 *
 * @param {string} [params.notificationType=general] - The type of the message.
 *                                                     Can be whatever you want.
 *                                                     It's optional and defaults
 *                                                     to "general".
 *
 * @param {Object[]} params.users - An array of objects containing the username
 *                                  and associated notification endpoint for
 *                                  that user:
 *                                  [
 *                                      {
 *                                          username: joeblow,
 *                                          notificationEndpoint: sms:+1234567890
 *                                      },
 *                                      ...
 *                                  ]
 *
 * @param cb
 *
 */
function requestNotifications(params, cb) {

    let incomingParams = Object.keys(params);

    const requiredParams = [
        'accountId',
        'notification',
        'realmId',
        'users'
    ];

    //Ensure the required parameters are provided
    let missingParams = ld.difference(requiredParams, incomingParams);
    if (!ld.isEmpty(missingParams)) {
        const errMessage = 'missing required parameter(s) ' + missingParams;
        logger.error(errMessage);
        return cb(new errors.BadRequestDetailsError('requestBadParameter', errMessage));
    }

    params.priority = params.priority || 'informational';
    params.priorityLevel = params.priorityLevel || 10;

    params.services = params.services || [
        'broadcast',
        'cloud',
        'mailbox'
    ];

    params.notificationType = params.notificationType || 'general';

    // logger.debug('requestNotifications', 'params', JSON.stringify(Object.keys(params));

    //We'll clone it here so that we're working with a locally scoped version
    //that will get cleaned up after and won't impact the incoming params.
    let context = ld.cloneDeep(params);

    ld.set(context, 'notification.priorityLevel', params.priorityLevel);
    ld.set(context, 'notification.notificationType', params.notificationType);

    logger.debug(
        'requestNotifications',
        'notification', JSON.stringify(context.notification),
        'users', JSON.stringify(context.users)
    );

    async.waterfall([

        function (acb) {

            if (context.realmInfo) {
                return acb();
            }

            getRealmInfoForAccount(context.accountId, context.realmId, function (err, realmInfo) {

                if (err) {
                    return acb(err);
                }

                context.realmInfo = realmInfo;
                acb();
            });
        },

        function (acb) {

            let issuer =
                ld.get(context, 'notification.global.issuer') ||
                ld.get(context, 'realmInfo.displayName') ||
                'Voyent Alert!';

            context.issuer = issuer;
            context.timezone = context.realmInfo.timezone;
            context.timezoneCode = getTimezoneCode(context.realmInfo);
            context.timezoneOffset = getTimezoneOffset(context.realmInfo);
            acb();

        },

        function (acb) {
            context.batchId = uuid.v4();
            context.time = new Date().toISOString();

            if (params.skipLogs) {
                logger.debug('skipLogs has been set so no processing of notification logs');
                acb();
            } else {
                processNotificationLogs(context, acb);
            }
        },

        function (acb) {
            context.payloads = ld.compact(buildNotificationPayloads(context));
            context.hasNoPayloads = ld.get(context, 'payloads.length', 0) === 0;
            // logger.debug('requestNotifications', 'payloads: ', JSON.stringify(context.payloads));
            acb();
        },

        function (acb) {
            if (context.hasNoPayloads) {
                logger.debug('requestNotifications', 'no payloads to save');
                return acb();
            }
            saveNotificationPayloads(context, acb);
        },

        function (acb) {
            if (context.hasNoPayloads) {
                logger.debug('requestNotifications', 'no payloads, cancelling batch event');
                return acb();
            }
            sendBatchEvent(context, acb);
        }

    ], function (err) {

        if (err) {
            logger.error('requestNotifications', 'error', err.message);
            return cb(err);
        }

        logger.debug('requestNotifications', 'complete');
        cb(null, params);

    });
}

module.exports.requestNotifications = requestNotifications;
