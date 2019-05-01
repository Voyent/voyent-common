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

const config = require('./config');
const ld = require('lodash');
const async = require('async');
const as = require('./aws-startup');

function SQSClient() {

    let fullQueueName;
    let queueUrl;
    let messageProcessor;

    function connect() {

        const logger = require('./loggers').getLogger();

        if (!queueUrl) {
            throw new Error('cannot poll, queueUrl is not set');
        }

        const params = {
            QueueUrl: queueUrl,
            AttributeNames: ['All'],
            MaxNumberOfMessages: config.aws.queues.messagesToProcess,
            MessageAttributeNames: ['All'],
            VisibilityTimeout: config.aws.queues.visibilityTimeout,
            WaitTimeSeconds: config.aws.queues.pollingInterval
        };

        if(config.messages.showPolling){
            logger.debug('polling (', params.WaitTimeSeconds, 'sec)', queueUrl);
        }

        as.sqs.receiveMessage(params, responseHandler);
    }

    /**
     * Once you create an instance of this client, you call start and pass in
     * the name of the queue and a function you want to use to handle incoming
     * messages from the queue.
     *
     * @param topicName  The short name of the topic.  This is typically just
     *                   the SERVICE_NAME (e.g. action).
     * @param queueName  The short name of the queue to poll.
     * @param processor  The function to handle incoming messages.
     * @param cb
     *
     */
    function start(topicName, queueName, processor, cb) {

        if (!processor || !ld.isFunction(processor)) {
            cb(new Error('missing or invalid processor function'));
            return;
        }

        as.getQualifiedQueueName(topicName, queueName, function (err, qName) {

            if (err) {
                cb(err);
                return;
            }

            fullQueueName = qName;
            messageProcessor = processor;

            as.getQueueUrl(topicName, queueName, function (err, qURL) {

                if (err) {
                    cb(new Error('problem getting URL for queue ' + err.message));
                    return;
                }

                if (!qURL) {
                    cb(new Error('queue does not exist ' + queueName));
                    return;
                }

                queueUrl = qURL;

                connect();
                cb();

            });

        });

    }


    function changeMessageVisibility(handle, timeout) {

        const logger = require('./loggers').getLogger();

        const params = {
            QueueUrl: queueUrl,
            ReceiptHandle: handle,
            VisibilityTimeout: timeout || 0
        };

        as.sqs.changeMessageVisibility(params, function (err) {
            if (err) {
                logger.error('problem changing message invisibility', params, err);
            } else {
                logger.debug('message visibility modified', params);
            }
        });
    }


    function deleteMessage(handle) {

        const logger = require('./loggers').getLogger();

        const params = {
            QueueUrl: queueUrl,
            ReceiptHandle: handle
        };

        as.sqs.deleteMessage(params, function (err) {
            if (err) {
                logger.error('problem deleting message', err.message);
            }
        });
    }


    function responseHandler(err, response) {

        const logger = require('./loggers').getLogger();

        //TODO: improve client handling of errors to be more robust
        if (err) {
            logger.error('problem receiving message', err.message);
        }

        if (response) {

            if (response.Messages && response.Messages.length > 0) {

                // logger.debug('response has', response.Messages.length, 'messages');

                //Currently, we only receive a single message at a time and
                //process it.  This is likely inefficient in one sense but it
                //may spread out the message handling across multiple service
                //instances.  We should investigate/discuss this in more
                //detail.
                const firstMessage = response.Messages[0];
                // logger.debug('firstMessage', JSON.stringify(firstMessage));


                //Now we try and parse our own event out of the AWS message
                //structure.
                let event = {};

                try {
                    //Parse the entire message we get from AWS.
                    let body = JSON.parse(firstMessage.Body);

                    //Parse our own Voyent event from the message body.
                    event = JSON.parse(body.Message);
                } catch (e) {
                    logger.error('problem parsing message', e);
                    return;
                }

                //TODO: Not sure if this ever happens but we should do
                //something to store it so that it can be fixed or whatever
                //else needs to be done.
                if (!firstMessage.ReceiptHandle) {
                    logger.error(
                        'message has no ReceiptHandle, cannot process further',
                        JSON.stringify(firstMessage));
                    return;
                }

                //Add functions to the event that can be used to complete
                //the handling of the event successfully, fatally, or leave it
                //in the queue so that we can retry it.

                //In the case that the handling completes successfully,
                //call, event.success() which will delete the message
                //from the queue so that it never gets processed by any
                //other listeners of the queue.
                event.success = function () {
                    logger.debug('event.success', firstMessage.ReceiptHandle);
                    deleteMessage(firstMessage.ReceiptHandle);
                };

                //If the handling results in an error that cannot
                //eventually be resolved, call event.fatal() with an
                //optional error parameter.  The message is deleted
                //from the queue because it can never be successfully
                //processed.
                //TODO:  Potentially store these so they are are not lost
                event.fatal = function (eventProcessingErr) {

                    logger.error(
                        'event.fatal',
                        ld.get(eventProcessingErr, 'message', ''),
                        firstMessage.ReceiptHandle,
                        JSON.stringify(event));

                    deleteMessage(firstMessage.ReceiptHandle);
                };

                //If we don't want to handle the event for some reason but it's
                //not considered an error, we can ignore it.  This removes it
                //from the queue with gentler logging.  This is generally the
                //case where we couldn't sufficiently filter the message via the
                //queue subscription but discover once we get it that we don't
                //really need to handle it.
                event.ignore = function (eventProcessingMessage) {

                    logger.debug(
                        'event.ignore',
                        eventProcessingMessage || '',
                        firstMessage.ReceiptHandle,
                        JSON.stringify(event));

                    deleteMessage(firstMessage.ReceiptHandle);
                };

                //If the handling results in an error that can
                //eventually be resolved, call event.retry() with
                //optional parameters for the number of secs of message
                //invisibility.  This hides the message from being
                //processed again until the time expires.  The default
                //is currently 30 seconds.  An example might be that
                //we lose connectivity to the database.  When the link
                //is restored, it's possible that the event could then
                //be successfully handled.  It's possible to set the
                //suspension time to 0 which makes the message visible
                //immediately.
                event.retry = function (eventProcessingErr, secs) {

                    let msg = 'no error message, retrying event';
                    if(eventProcessingErr){
                        msg = eventProcessingErr.message;
                    }

                    const baseVisibilityTimeout = config.aws.retry.baseVisibilityTimeout;
                    const maxVisibilityTimeout = config.aws.retry.maxVisibilityTimeout;

                    let suspendedFor = baseVisibilityTimeout;

                    //This is the min and max (12 hours) supported by AWS
                    if (secs && ld.inRange(secs, 0, 43200)) {
                        suspendedFor = secs;
                        logger.debug('suspending via param', secs);
                    }

                    //This indicates how many attempts we've made to process this
                    //message and somehow failed.  After a certain number it will
                    //be sent to the Dead Letter Queue but until then, we keep
                    //trying, waiting a bit longer each time to make the next
                    //attempt.
                    let attempts = ld.get(firstMessage, 'Attributes.ApproximateReceiveCount');
                    if (!attempts) {
                        logger.warn(
                            'message has no ApproximateReceiveCount',
                            JSON.stringify(firstMessage));
                    } else {
                        suspendedFor = Math.pow(2, (attempts - 1)) * baseVisibilityTimeout;
                        logger.debug('suspending via attempts', attempts, suspendedFor);
                    }

                    if (suspendedFor > maxVisibilityTimeout) {
                        logger.debug('suspending constrained to max', suspendedFor, maxVisibilityTimeout);
                        suspendedFor = maxVisibilityTimeout;
                    }


                    logger.debug(
                        'event.retry',
                        'suspending message visibility for', suspendedFor,
                        'after', attempts, 'attempts',
                        firstMessage.ReceiptHandle,
                        msg
                    );

                    changeMessageVisibility(firstMessage.ReceiptHandle, suspendedFor);

                };

                messageProcessor(event);
            }

        } else {
            logger.debug('no response');
        }

        connect();

    }

    this.start = start;
    return this;
}

/**
 * Constructor that can be used directly to create an SQS client.
 *
 * @returns {*}
 */
module.export = function () {
    return SQSClient;
};


/**
 * Convenience method that takes a subscription, creates the AWS
 * artifacts required, and starts a client that listens for the desired events.
 * Matching events are then forwarded to the specified handler.

 * @param subscription
 * @param subscription.topicNames
 * @param subscription.queueName
 * @param subscription.filter
 * @param subscription.handler
 * @param cb
 */
function subscribeAndListen(subscription, cb) {

    as.createSubscription(subscription, function (err) {

        if (err) {
            cb(err);
            return;
        }

        let client = new SQSClient();

        //If there is a single topic name, use that.  If there are multiple
        //topics for the same queue, then the name for the topic will be the
        //value specified for the MULTIPLE_TOPICS constant.
        let topicName = as.getTopicName(subscription.topicNames);

        client.start(
            topicName,
            subscription.queueName,
            subscription.handler,
            function (err) {

                if (err) {
                    cb(err);
                    return;
                }

                cb();
            });

    });

}

module.exports.subscribeAndListen = subscribeAndListen;


/**
 * Takes an array of subscriptions and calls subscribeAndListen() for each one.
 *
 * @param cb
 */
function subscribeAllAndListen(subscriptions, cb) {

    async.each(subscriptions, subscribeAndListen, function (err) {

        if (err) {
            cb(err);
            return;
        }

        cb();
    });

}

module.exports.subscribeAllAndListen = subscribeAllAndListen;


