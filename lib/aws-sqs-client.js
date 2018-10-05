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

const ld = require('lodash');
const async = require('async');
const ac = require('./aws-common');


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
            MaxNumberOfMessages: 1,
            MessageAttributeNames: ['All'],
            VisibilityTimeout: 5,
            WaitTimeSeconds: 20
        };

        logger.debug('polling (', params.WaitTimeSeconds, 'sec)', queueUrl);

        ac.sqs.receiveMessage(params, responseHandler);
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

        ac.getQualifiedQueueName(topicName, queueName, function (err, qName) {

            if (err) {
                cb(err);
                return;
            }

            fullQueueName = qName;
            messageProcessor = processor;

            ac.getQueueUrl(topicName, queueName, function (err, qURL) {

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

        ac.sqs.changeMessageVisibility(params, function (err) {
            if (err) {
                logger.error('problem ending message invisibility', err.message);
            } else {
                logger.debug('message invisibility ended', handle);
            }
        });
    }


    function deleteMessage(handle) {

        const logger = require('./loggers').getLogger();

        const params = {
            QueueUrl: queueUrl,
            ReceiptHandle: handle
        };

        ac.sqs.deleteMessage(params, function (err) {
            if (err) {
                logger.error('problem deleting message', err.message);
            } else {
                logger.debug('message deleted', handle);
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

                //Currently, we only receive a single message at a time and
                //process it.  This is likely inefficient in one sense but it
                //may spread out the message handling across multiple service
                //instances.  We should investigate/discuss this in more
                //detail.
                const firstMessage = response.Messages[0];

                //Right now we are deleting the message as soon as we've
                //successfully retrieved it.  However, the real goal is to
                //delete it if it's successfully handled or "unhide" it if a
                //problem occurred and the event should be left for another
                //service instance to handle.
                deleteMessage(firstMessage.ReceiptHandle);

                let event = {};

                try {

                    //Parse the entire message we get from AWS.
                    let body = JSON.parse(firstMessage.Body);

                    //Parse our own Voyent event from the message body.
                    event = JSON.parse(body.Message);

                    //Add functions to the event that can be used to complete
                    //the handling of the event in either a success or failure
                    //scenario.

                    if (firstMessage.ReceiptHandle) {

                        //  In the case that the handling completes successfully,
                        //  call, event.success() which will delete the message
                        //  from the queue.
                        event.success = function () {
                            deleteMessage(firstMessage.ReceiptHandle);
                        };

                        //  In the case that the handling does not complete
                        //  successfully due to an error, call event.failure() with
                        //  an optional err parameter.  This will mark the message
                        //  as visible again on the queue so that it can be picked
                        //  up and tried again by this service instance or another
                        //  service instance.
                        event.failure = function (err) {

                            if (err) {

                                logger.error(
                                    'event handling was not successfully completed',
                                    err.message);
                            }

                        };

                        //  To avoid getting stuck in a loop where the event
                        //  continually causes an error and would continually
                        //  stay in queue, we process it by extending the
                        //  invisibility of the
                        event.suspend = function (secs) {

                            logger.debug(
                                'suspending message', firstMessage.ReceiptHandle,
                                'visibility for', secs);

                            changeMessageVisibility(firstMessage.ReceiptHandle, secs || 30);

                        };

                    }

                } catch (e) {
                    logger.error('problem parsing message', e);
                    return;
                }

                logger.debug('response has', response.Messages.length, 'messages');
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

    ac.createSubscription(subscription, function (err) {

        if (err) {
            cb(err);
            return;
        }

        let client = new SQSClient();

        //If there is a single topic name, use that.  If there are multiple
        //topics for the same queue, then the name for the topic will be the
        //value specified for the MULTIPLE_TOPICS constant.
        let topicName = ac.getTopicName(subscription.topicNames);

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


