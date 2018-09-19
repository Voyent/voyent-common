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
const ac = require('./aws-common');


module.exports = function () {

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
            VisibilityTimeout: 2,
            WaitTimeSeconds: 20
        };

        logger.debug(
            new Date().toISOString(),
            'polling', queueUrl,
            'every', params.WaitTimeSeconds, 'seconds'
        );

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


    function endMessageInvisibility(handle) {

        const logger = require('./loggers').getLogger();

        const params = {
            QueueUrl: queueUrl,
            ReceiptHandle: handle,
            VisibilityTimeout: 0
        };

        ac.sqs.changeMessageVisibility(params, function (err) {
            if (err) {
                logger.error('problem changing message visibility', err.message);
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
                // logger.debug('message deleted', handle);
            }

        });
    }


    function responseHandler(err, response) {

        const logger = require('./loggers').getLogger();

        if (err) {
            logger.error('problem receiving message', err.message);
        }

        if (response) {

            if (response.Messages && response.Messages.length > 0) {

                const firstMessage = response.Messages[0];
                deleteMessage(firstMessage.ReceiptHandle);

                let event = {};
                try {
                    let body = JSON.parse(firstMessage.Body);
                    event = JSON.parse(body.Message);
                } catch (e) {
                    logger.error('problem parsing message', e);
                    return;
                }

                logger.debug('response has', response.Messages.length, 'messages');
                messageProcessor(event);
            } else {
                logger.debug('response has no messages');
            }
        } else {
            logger.debug('no response');
        }

        connect();

    }

    this.start = start;
    return this;
};