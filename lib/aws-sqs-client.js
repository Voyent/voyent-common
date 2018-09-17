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

/**
 * We export the SQSClient as a constructor function which allows multiple,
 * separate instances to be created.  Usage is as follows:
 *

 //Import the common and client libraries.

 const ac = require('./aws-common');
 const SQSClient = require('./aws-sqs-client');


 //Create a function for creating and starting the client.  The assumption is
 //that the queue has been created and subscribed to the topic already.  This
 //client will be listening to that specific queue.

 function startAWSClient(queueName){


    //Create a function for handling the incoming messages.

    function messageProcessor(message) {


        //The incoming messages are raw AWS messages.  To turn them back into
        //Voyent events, use the provided utility function.

        let event = ac.convertMessageAttributesToEvent(message);


        //Do whatever you need to do with the event.

        console.log('messageProcessor', queueName, JSON.stringify(event, null, 4));
    }


    //Create a new instance of the SQSClient.  You can create multiple instances
    //of the client, each listening to a different queue.

    let client = new SQSClient();


    //Start the client with it listening to the appropriate queue and with
    //the appropriate handler for incoming messages.

    client.start(queueName, messageProcessor, function(err){
        if(err){
            console.log('problem starting SQS client:', err.message);
        }
    });

}
 */

module.exports = function () {

    let queueName;
    let queueUrl;
    let messageProcessor;

    function connect() {

        const logger = require('./loggers').getLogger();

        if(!queueUrl){
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
     * @param name  The name of the queue to poll.
     * @param processor  The function to handle incoming messages.
     * @param cb
     *
     */
    function start(name, processor, cb) {

        if (!name) {
            cb(new Error('missing or invalid queue name'));
            return;
        }

        if (!processor || !ld.isFunction(processor)) {
            cb(new Error('missing or invalid processor function'));
            return;
        }

        queueName = name;
        messageProcessor = processor;

        ac.getQueueUrl(queueName, function (err, qURL) {

            if (err) {
                cb(new Error('problem getting URL for queue ' + err.message));
                return;
            }

            if(!qURL){
                cb(new Error('queue does not exist ' + queueName));
                return;
            }

            queueUrl = qURL;

            connect();
            cb();

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
                logger.debug('message deleted', handle);
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
                const msg = response.Messages[0];
                deleteMessage(msg.ReceiptHandle);
                logger.debug('response has', response.Messages.length, 'messages');
                messageProcessor(msg);
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
