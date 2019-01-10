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
const AWS = require('aws-sdk');
const async = require('async');
const ld = require('lodash');

const scopes = require('./scopes');
const tools = require('./tools');
const db = require('./db');

const DLQ_TOPIC_NAME = 'internal';
const DLQ_QUEUE_NAME = 'dlq';

let environmentName;
let serviceName;
let credentials;

//Determine how AWS services are being provided.  When running locally, we
//use localstack.  When running on AWS, we use the actual AWS services.
const awsProvider = process.env.AWS_PROVIDER || 'amazon';
console.log('AWS provider is [' + awsProvider + ']');

//Things like region and where we get credentials are different when running
//on localstack vs real AWS.
const awsRegion = process.env.AWS_REGION || 'ca-central-1';

//Variables for the aws-sdk APIs.  They are set below depending on whether we
//are running against localstack or actual AWS endpoints.
let s3;
let sns;
let sqs;

//Once we have a topic arn, we do not want to keep looking it up as that can
//easily exceed rate limits imposed by AWS.
//  https://docs.aws.amazon.com/general/latest/gr/aws_service_limits.html
let cachedTopicArns = {};

//Setting up the AWS SDK is slightly different depending on if we are running
//locally using localstack or against the real AWS service.

if (awsProvider === 'localstack') {

    //For localstack, we can just use fake credentials as it doesn't do any
    //real verification.
    credentials = new AWS.Credentials({
        accessKeyId: 'dummyAccessKey',
        secretAccessKey: 'dummySecret',
        sessionToken: 'dummySessionToken'
    });

    AWS.config.update({
        region: awsRegion,
        credentials: credentials
    });

    //The endpoints for the various services need to be set to match what the
    //local Docker network will be exposing, which is the service name.
    s3 = new AWS.S3({endpoint: "http://aws:4572"});
    sns = new AWS.SNS({endpoint: "http://aws:4575"});
    sqs = new AWS.SQS({endpoint: "http://aws:4576"});

} else {

    //When using the real AWS service, the credentials are provided to the
    //Docker container so we don't need to set them explicitly.  We still
    //do the region though.

    AWS.config.update({
        region: awsRegion
    });

    s3 = new AWS.S3();
    sns = new AWS.SNS();
    sqs = new AWS.SQS();

}

module.exports.s3 = s3;
module.exports.sns = sns;
module.exports.sqs = sqs;

//The topic name to use when a single queue is subscribed to multiple topics.
const MULTIPLE_TOPICS = 'multipleTopics';
module.exports.MULTIPLE_TOPICS = MULTIPLE_TOPICS;

function isValidName(name, length) {

    if (!name) {
        return false;
    }

    const numOfChars = length || 24;

    const reString = '^([a-zA-Z0-9\\-\\_]){1,' + numOfChars + '}$';
    const re = RegExp(reString);
    return re.test(name);
}

function isValidTopicName(topicName) {
    return isValidName(topicName, 24);
}

function isValidQueueName(queueName) {
    return isValidName(queueName, 16);
}

function getQueuePolicy(queueArn) {

    const split = queueArn.split(':', 5);
    split[2] = 'sns';
    const sourceArn = split.join(':') + ':*';

    return {
        "Version": "2012-10-17",
        "Id": queueArn + "/SQSDefaultPolicy",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "AWS": "*"
                },
                "Action": "SQS:SendMessage",
                "Resource": queueArn,
                "Condition": {
                    "ArnEquals": {
                        "aws:SourceArn": sourceArn
                    }
                }
            }
        ]
    };
}

function getRedrivePolicy(dlqArn) {

    return {
        "deadLetterTargetArn": dlqArn,
        "maxReceiveCount": config.aws.dlq.maxReceiveCount
    };
}


function getTopicName(topicNames) {
    return topicNames.length === 1 ? topicNames[0] : MULTIPLE_TOPICS;
}

module.exports.getTopicName = getTopicName;


/**
 * Create a new SQS queue with the provided name.  The queue is created with
 * default values.
 *
 * @param topicName
 * @param queueName
 * @param cb
 */
function createQueue(topicName, queueName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    if (!isValidQueueName(queueName)) {
        cb(new Error('queue name is invalid ' + queueName));
        return;
    }

    let queueArn;
    let queueUrl;

    async.waterfall([

        function (acb) {
            getQualifiedQueueName(topicName, queueName, acb);
        },

        function (queueName, acb) {

            const params = {
                QueueName: queueName,
                Attributes: {
                    MessageRetentionPeriod: config.aws.queues.messageRetention,
                    ReceiveMessageWaitTimeSeconds: config.aws.queues.pollingInterval,
                    VisibilityTimeout: config.aws.queues.visibilityTimeout
                }
            };

            sqs.createQueue(params, acb);
        },

        function (data, acb) {

            queueUrl = data.QueueUrl;

            getQueueArn(topicName, queueName, function (err, arn) {

                if (err) {
                    acb(err);
                    return;
                }

                queueArn = arn;
                acb(null, queueArn);
            });
        },

        function (queueArn, acb) {
            createDeadLetterQueue(acb);
        },

        function (dlqArn, acb) {

            const params = {
                QueueUrl: queueUrl,
                Attributes: {
                    Policy: JSON.stringify(getQueuePolicy(queueArn)),
                    RedrivePolicy: JSON.stringify(getRedrivePolicy(dlqArn))
                }
            };

            sqs.setQueueAttributes(params, acb);
        }

    ], function (err, results) {

        if (err) {
            cb(err);
            return;
        }

        cb(null, queueArn);

    });

}

module.exports.createQueue = createQueue;


/**
 * Create multiple SQS queues based on the provided array of names.
 *
 * @param names
 * @param cb
 */
function createQueues(names, cb) {

    if (!names || !ld.isArray(names) || ld.isEmpty(names)) {
        cb(new Error('no array of queue names provided'));
        return;
    }

    async.map(names, createQueue, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        cb(null, data);

    });

}

module.exports.createQueues = createQueues;


/**
 * Creates a special queue to be used as a Dead Letter Queue (DLQ).  Generally
 * speaking, we only need one for an entire service as multiple queues can use
 * the same DLQ.
 *
 * @param cb
 */
function createDeadLetterQueue(cb) {

    const topicName = DLQ_TOPIC_NAME;
    const queueName = DLQ_QUEUE_NAME;

    getQualifiedQueueName(topicName, queueName, function (err, qName) {

        if (err) {
            cb(err);
            return;
        }

        const params = {
            QueueName: qName,
            Attributes: {
                MessageRetentionPeriod: config.aws.dlq.messageRetention
            }
        };

        sqs.createQueue(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            getQueueArn(topicName, queueName, function (err, queueArn) {

                if (err) {
                    cb(err);
                    return;
                }

                const params = {
                    QueueUrl: data.QueueUrl,
                    Attributes: {
                        Policy: JSON.stringify(getQueuePolicy(queueArn))
                    }
                };

                sqs.setQueueAttributes(params, function (err) {

                    if (err) {
                        cb(err);
                        return;
                    }

                    cb(null, queueArn);
                });
            });
        });
    });
}

module.exports.createDeadLetterQueue = createDeadLetterQueue;


/**
 * Delete the queue with the provided name.
 *
 * @param topicName
 * @param queueName
 * @param cb
 */
function deleteQueue(topicName, queueName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    if (!isValidQueueName(queueName)) {
        cb(new Error('queue name is invalid ' + queueName));
        return;
    }

    getQualifiedQueueName(topicName, queueName, function (err, qName) {

        if (err) {
            cb(err);
            return;
        }

        getQueueUrl(qName, function (err, qURL) {

            if (err) {
                cb(err);
                return;
            }

            const params = {
                QueueUrl: qURL
            };

            sqs.deleteQueue(params, function (err, data) {

                if (err) {
                    cb(err);
                    return;
                }

                cb(null, data);

            });

        });

    });


}

module.exports.deleteQueue = deleteQueue;


/**
 * Delete all the queues with the provided array of names.
 *
 * @param names
 * @param cb
 */
function deleteQueues(names, cb) {

    if (!names || !ld.isArray(names) || ld.isEmpty(names)) {
        cb(new Error('no array of queue names provided'));
        return;
    }

    async.map(names, deleteQueue, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        cb(null, data);

    });

}

module.exports.deleteQueues = deleteQueues;


/**
 * Create a new SNS topic with the provided name.
 *
 * @param topicName
 * @param cb
 */
function createTopic(topicName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    getQualifiedTopicName(topicName, function (err, tName) {

        if (err) {
            cb(err);
            return;
        }

        const params = {
            Name: tName
        };

        sns.createTopic(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            cb(null, data);

        });

    });
}

module.exports.createTopic = createTopic;


/**
 * Create a new SNS topic using the value of the SERVICE_NAME environment
 * variable.
 *
 * @param cb
 */
function createServiceTopic(cb) {
    createTopic(getServiceName(), cb);
}

module.exports.createServiceTopic = createServiceTopic;


/**
 * Create multiple SNS topics based on the provided array of names.
 *
 * @param names
 * @param cb
 */
function createTopics(names, cb) {

    if (!names || !ld.isArray(names) || ld.isEmpty(names)) {
        cb(new Error('no array of topic names provided'));
        return;
    }

    async.map(names, createTopic, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        cb(null, data);

    });

}

module.exports.createTopics = createTopics;


/**
 * Delete the topic with the provided name.
 *
 * @param topicName
 * @param cb
 */
function deleteTopic(topicName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    getTopicArn(topicName, function (err, topicArn) {

        const params = {
            TopicArn: topicArn
        };

        sns.deleteTopic(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            cb(null, data);

        });

    });
}

module.exports.deleteTopic = deleteTopic;


/**
 * Delete all the topics with the provided array of names.
 *
 * @param names
 * @param cb
 */
function deleteTopics(names, cb) {

    if (!names || !ld.isArray(names) || ld.isEmpty(names)) {
        cb(new Error('no array of topic names provided'));
        return;
    }

    async.map(names, deleteTopic, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        cb(null, data);

    });

}

module.exports.deleteTopics = deleteTopics;


function getAllTopics(cb) {

    const logger = require('./loggers').getLogger();

    let nextToken;
    let allTopics = [];

    //Returns a list of all the topics we have. Each call returns a limited list
    //of topics, up to 100. If there are more topics, a NextToken is also returned.
    //Use the NextToken parameter to get further results.
    async.doWhilst(
        function (acb) {

            let params = {};
            if (nextToken) {
                params.NextToken = nextToken;
            }

            sns.listTopics(params, function (err, data) {

                if (err) {
                    acb(err);
                    return;
                }

                allTopics = ld.concat(allTopics, data.Topics);
                nextToken = data.NextToken;

                logger.debug(
                    'getAllTopics',
                    'current', data.Topics.length,
                    'total', allTopics.length,
                    nextToken
                );

                acb();
            });
        },
        function () {

            if (nextToken) {
                return true;
            }
            return false;
        },
        function (err) {

            if (err) {
                cb(err);
                return;
            }

            cb(null, allTopics);
        }
    );

}


/**
 * Use the provided topic name to get the official topic ARN.
 *
 * @param topicName
 * @param cb
 */
function getTopicArn(topicName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    //If we have it cached, use that.
    if (cachedTopicArns[topicName]) {
        cb(null, cachedTopicArns[topicName].TopicArn);
        return;
    }

    getQualifiedTopicName(topicName, function (err, tName) {

        if (err) {
            cb(err);
            return;
        }

        getAllTopics(function (err, topics) {

            if (err) {
                cb(err);
                return;
            }

            let topicArn = ld.find(topics, function (item) {
                return item.TopicArn.endsWith(':' + tName);
            });

            if (!topicArn) {
                const logger = require('./loggers').getLogger();
                logger.debug('cannot get ARN for', tName, JSON.stringify(topics));
                cb(new Error('cannot get ARN for ' + tName));
                return;
            }

            //Store it so we don't have to look it up again.
            cachedTopicArns[topicName] = topicArn;

            cb(null, topicArn.TopicArn);

        });

    });
}

module.exports.getTopicArn = getTopicArn;


/**
 * Use the provided queue name to get the official queue URL.
 *
 * @param topicName
 * @param queueName
 * @param cb
 */
function getQueueUrl(topicName, queueName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    if (!isValidQueueName(queueName)) {
        cb(new Error('queue name is invalid ' + queueName));
        return;
    }

    getQualifiedQueueName(topicName, queueName, function (err, qName) {

        if (err) {
            cb(err);
            return;
        }

        let params = {
            QueueName: qName
        };

        sqs.getQueueUrl(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            cb(null, data.QueueUrl);

        });

    });
}

module.exports.getQueueUrl = getQueueUrl;


/**
 * Use the provided queue name to get the official queue ARN.
 *
 * @param topicName
 * @param queueName
 * @param cb
 */
function getQueueArn(topicName, queueName, cb) {

    getQueueUrl(topicName, queueName, function (err, qURL) {

        if (err) {
            cb(err);
            return;
        }

        if (!qURL) {
            cb(new Error('queue does not exist for ' + topicName + ' ' + queueName));
            return;
        }

        const params = {
            QueueUrl: qURL,
            AttributeNames: ['All']
        };

        sqs.getQueueAttributes(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            if (!data) {
                cb(new Error('cannot get attributes for queue ' + qURL));
                return;
            }

            cb(null, ld.get(data, 'Attributes.QueueArn'));

        });

    });
}

module.exports.getQueueArn = getQueueArn;


/**
 * Get the official ARN for the DLQ of this service.
 *
 * @param cb
 */
function getDeadLetterQueueArn(cb) {
    getQueueArn(DLQ_TOPIC_NAME, DLQ_QUEUE_NAME, cb);
}

module.exports.getDeadLetterQueueArn = getDeadLetterQueueArn;


function convertPropertyToAttribute(key, value) {

    const logger = require('./loggers').getLogger();

    let result;

    if (ld.isUndefined(value) || ld.isEmpty(value)) {

        //You can't have undefined values or empty strings in Message
        //Attributes or AWS will complain and not publish it.  Rather than
        //have it disappear completely, we provide standard filler value that
        //allows it to get published but makes it easier to debug.
        result = {};
        result[key] = {
            DataType: "String",
            StringValue: "[value is undefined]"
        };

    } else if (ld.isString(value)) {

        result = {};
        result[key] = {
            DataType: "String",
            StringValue: value
        };

    } else if (ld.isNumber(value)) {

        result = {};
        result[key] = {
            DataType: "Number",
            StringValue: value.toString()
        };
        return result;
    } else {

        logger.debug('convertPropertyToAttribute',
            'value is not String or Number',
            typeof value);
    }

    return result;

}

/**
 * Given a Voyent event, convert the event properties to a set of valid topic
 * message attributes.  Top-level attributes are converted to Strings.  For the
 * data property, the nested object properties are not converted.  Instead, the
 * entire nested object is converted to a single String and saved under data.
 *
 * AWS won't take 'stringified' objects as message attributes, so any properties
 * in the event that are objects will be ignored.  This typically just means the
 * 'data' property.  The whole event can be stringified as the message which is
 * what we'll do.  That way, the attributes can be used for filtering but the
 * event can just be stringified and parsed at either end.
 *
 * @param event
 */
function convertEventToMessageAttributes(event) {

    const logger = require('./loggers').getLogger();

    let attrs = {};

    ld.forEach(event, function (val, key) {

        if (ld.isUndefined(val)) {

            logger.warn('convertEventToMessageAttributes',
                key,
                'has undefined value');

        } else if (ld.isObject(val)) {

            //Trying to convert some data properties, specifically, HTML email
            //messages, causes an issue for AWS queues that have filters which
            //causes it to not get delivered to the queue.  So turning this off
            //for the time being as we don't currently get AWS to filter on
            //stuff in the data section anyway.
            logger.debug('convertEventToMessageAttributes',
                'not converting objects');

            // ld.forEach(val, function (val2, key2) {
            //     let nestedKey = key + '_' + key2;
            //     let convert = convertPropertyToAttribute(key2, val2);
            //     if (convert) {
            //         attrs[nestedKey] = convert[key2];
            //     }
            // });

        } else {
            let convert = convertPropertyToAttribute(key, val);
            if (convert) {
                attrs[key] = convert[key];
            }
        }

    });

    return attrs;

}

module.exports.convertEventToMessageAttributes = convertEventToMessageAttributes;


function saveEventToDB(event, cb) {

    const logger = require('./loggers').getLogger();

    const newEvent = {
        _data: event,
        _permissions: {
            owner: event.username || 'unknown',
            rights: {
                owner: ["r"],
                realm: ["r"],
                roles: {}
            }
        }
    };

    const collectionName = 'events';

    db.getCollection(event.account, event.realm, collectionName, function (err, coll) {

        if (err) {

            logger.error(
                'could not get collection:',
                event.account,
                event.realm,
                collectionName,
                err
            );

            cb(err);
            return;
        }

        coll.insertOne(newEvent, function (err, result) {

            if (err) {

                logger.error(
                    'could not save event to database:',
                    event.account,
                    event.realm,
                    collectionName,
                    err
                );

                cb(err);
                return;
            }

            cb();

        });

    });
}


/**
 * Publishes a message and set of message attributes to the named topic.  The
 * topic then broadcasts these messages to any subscribed queues.  Note that
 * if you are sending a Voyent event, you should convert the event to message
 * attributes using convertEventToMessageAttributes() before sending with this
 * API.
 *
 * @param topicName
 * @param message
 * @param attrs
 * @param cb
 */
function publishMessageToTopic(topicName, message, attrs, cb) {

    const logger = require('./loggers').getLogger();

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    message = message || 'No message provided.';
    attrs = attrs || {};

    getTopicArn(topicName, function (err, topicArn) {

        if (err) {
            cb(err);
            return;
        }

        if (!topicArn) {
            cb(new Error('could not get topic ARN for ' + topicName));
            return;
        }

        const params = {
            Message: message,
            MessageAttributes: attrs,
            TargetArn: topicArn
        };

        sns.publish(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            logger.debug('published', topicName, message);

            saveEventToDB(JSON.parse(message), function (err) {

                if (err) {
                    cb(err);
                    return;
                }

                cb(null, data);

            });
        });
    });
}

module.exports.publishMessageToTopic = publishMessageToTopic;


function publishEventToTopic(topicName, event) {

    const logger = require('./loggers').getLogger();

    const message = JSON.stringify(event);
    const attrs = convertEventToMessageAttributes(event);

    publishMessageToTopic(topicName, message, attrs, function (err, data) {

        if (err) {
            logger.error(
                'problem publishing message',
                topicName,
                message,
                JSON.stringify(attrs),
                err.message);
        }

    });
}

module.exports.publishEventToTopic = publishEventToTopic;


function publishEventToServiceTopic(event) {
    publishEventToTopic(getServiceName(), event);
}

module.exports.publishEventToServiceTopic = publishEventToServiceTopic;

/**
 * Sends a message to the named queue.  This is generally not done directly and
 * is mostly here for test/future purposes.  Normally messages would be published
 * to topics which would then send the messages to any subscribed queues.
 *
 * @param topicName
 * @param queueName
 * @param message
 * @param cb
 */
function sendMessageToQueue(topicName, queueName, message, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    if (!isValidQueueName(queueName)) {
        cb(new Error('queue name is invalid ' + queueName));
        return;
    }

    getQueueUrl(topicName, queueName, function (err, queueUrl) {

        if (err) {
            cb(err);
            return;
        }

        const params = {
            MessageBody: message,
            QueueUrl: queueUrl,
            DelaySeconds: 0
        };

        sqs.sendMessage(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            cb(null, data);
        });

    });
}

module.exports.sendMessageToQueue = sendMessageToQueue;


/**
 * Get the subscriptions for the provided topic ARN.
 *
 * @param topicArn
 * @param cb
 */
function getSubscriptionsForTopic(topicArn, cb) {

    const params = {
        TopicArn: topicArn
    };

    sns.listSubscriptionsByTopic(params, function (err, data) {
        if (err) {
            cb(err);
            return;
        }

        cb(null, data);
    });

}


/**
 * Checks to see if a queue is already subscribed to a topic.  This check is
 * necessary with localstack because there is a bug if you do multiple subscriptions
 * of the same queue to the same topic.  AWS works fine.
 *
 * @param topicArn
 * @param queueArn
 * @param cb
 */
function checkQueueAlreadySubscribed(topicArn, queueArn, cb) {

    getSubscriptionsForTopic(topicArn, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        const existingSub = ld.find(data.Subscriptions, function (sub) {
            return queueArn === sub.Endpoint;
        });

        if (existingSub) {
            cb(null, existingSub);
            return;
        }

        cb();

    });
}


/**
 * Subscribe the named queue to the named topic.  A check is made to ensure that
 * the subscription does not already exist to avoid a bug in localstack. If the
 * subscription already exists, it is not applied again.  If it does not yet
 * exist, it is created.
 *
 * @param topicName
 * @param queueName
 * @param cb
 */
function subscribeQueueToTopic(topicName, isMultiTopic, queueName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    if (!isValidQueueName(queueName)) {
        cb(new Error('queue name is invalid ' + queueName));
        return;
    }

    async.parallel({
        topicArn: function (acb) {
            getTopicArn(topicName, acb);
        },
        queueArn: function (acb) {

            if (isMultiTopic === true) {
                getQueueArn(MULTIPLE_TOPICS, queueName, acb);
            } else {
                getQueueArn(topicName, queueName, acb);
            }
        }
    }, function (err, results) {

        if (err) {
            cb(err);
            return;
        }

        checkQueueAlreadySubscribed(
            results.topicArn,
            results.queueArn,
            function (err, sub) {

                if (err) {
                    cb(err);
                    return;
                }

                if (sub) {
                    cb(null, sub);
                    return;
                }

                const params = {
                    Protocol: 'sqs',
                    TopicArn: results.topicArn,
                    Endpoint: results.queueArn
                };

                sns.subscribe(params, function (err, data) {

                    if (err) {
                        cb(err);
                        return;
                    }

                    cb(null, data);

                });

            });


    });

}

module.exports.subscribeQueueToTopic = subscribeQueueToTopic;


/**
 * Takes an array of topicNames and subscribes the queue to each topic. Since
 * there is a single queue but potentially multiple topics, we need to create
 * multiple subscriptions (one for each topic) but using the same queue name.
 *
 * @param topicNames
 * @param queueName
 * @param cb
 */
function subscribeQueueToTopics(topicNames, queueName, cb) {

    async.each(topicNames,

        function (topicName, acb) {
            subscribeQueueToTopic(
                topicName,
                (topicNames.length > 1),
                queueName,
                acb
            );

        }, function (err) {

            if (err) {
                cb(err);
                return;
            }

            cb();

        });
}

module.exports.subscribeQueueToTopics = subscribeQueueToTopics;


/**
 * Set a filter on a subscription.  When you subscribe a queue to a topic, the
 * relationship is recorded under a subscription ARN.
 *
 * @param topicName
 * @param queueName
 * @param filter
 * @param cb
 */
function setFilterForSubscription(topicName, isMultiTopic, queueName, filter, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    if (!isValidQueueName(queueName)) {
        cb(new Error('queue name is invalid ' + queueName));
        return;
    }

    async.parallel({
        topicArn: function (acb) {
            getTopicArn(topicName, acb);
        },
        queueArn: function (acb) {

            if (isMultiTopic === true) {
                getQueueArn(MULTIPLE_TOPICS, queueName, acb);
            } else {
                getQueueArn(topicName, queueName, acb);
            }

        }
    }, function (err, results) {

        if (err) {
            cb(err);
            return;
        }

        checkQueueAlreadySubscribed(
            results.topicArn,
            results.queueArn,
            function (err, sub) {

                if (err) {
                    cb(err);
                    return;
                }

                if (!sub) {
                    cb();
                    return;
                }

                const params = {
                    AttributeName: "FilterPolicy",
                    SubscriptionArn: sub.SubscriptionArn,
                    AttributeValue: JSON.stringify(filter)
                };

                sns.setSubscriptionAttributes(params, function (err, data) {

                    if (err) {
                        cb(err);
                        return;
                    }

                    cb(null, data);
                });

            });


    });
}

module.exports.setFilterForSubscription = setFilterForSubscription;


/**
 * Takes an array of topicNames and a queueName and sets the provided filter
 * on all the subscriptions.
 *
 * @param topicNames
 * @param queueName
 * @param filter
 * @param cb
 */
function setFilterForSubscriptions(topicNames, queueName, filter, cb) {

    async.each(topicNames,
        function (topicName, acb) {
            setFilterForSubscription(
                topicName,
                (topicNames.length > 1),
                queueName,
                filter,
                acb
            );

        }, function (err) {

            if (err) {
                cb(err);
                return;
            }

            cb();

        });
}

module.exports.setFilterForSubscriptions = setFilterForSubscriptions;


/**
 * A subscription is made up of a topic name, a queue, and an optional filter.
 * The topic name(s) are supplied as an array.  If there is more than one, then
 * a single queue is subscribed to all of the topics, with the topic name
 * specified as the value in MULTIPLE_TOPICS as part of the fully qualified
 * queue name.
 *
 * {
 *     topicNames: ["myTopicName1", "myTopicName2"],
 *     queueName: "myQueueName",
 *     filter: {
 *         foo: "barr",
 *         items: [
 *             "a",
 *             "b"
 *         ]
 *     }
 * }
 *
 * This function creates the topics, queue, and subscriptions as required and then
 * applies the filter policy to each subscription making it easier for services
 * to do the setup required.
 *
 * @param subscription
 * @param subscription.topicNames
 * @param subscription.queueName
 * @param subscription.filter
 * @param cb
 */
function createSubscription(subscription, cb) {

    //A subscription can have one or more topic names as array of
    //topic names.  Here we handle both cases.  First, if it's a String, simply
    //convert it to an array.

    console.log('createSubscription', JSON.stringify(subscription));

    async.waterfall(
        [
            function (acb) {
                //Create all the topics.  This is safe to do even if a topic
                //already exists.
                createTopics(subscription.topicNames, acb);
            },
            function (results, acb) {

                //Create the single queue that will be subscribed to one or
                //multiple topics.  If there is only one topic, then that will be
                //used as part of the fully qualified name.  If there are
                //multiple topics, the topic name will be the value specified
                //as the MULTIPLE_TOPICS constant.
                let topicName = getTopicName(subscription.topicNames);

                createQueue(topicName, subscription.queueName, acb);
            },
            function (results, acb) {

                //Subscribe this queue to each topic.
                subscribeQueueToTopics(
                    subscription.topicNames,
                    subscription.queueName,
                    acb
                );
            },
            function (acb) {

                //If a filter was provided, set a filter on each subscription.
                if (subscription.filter) {
                    setFilterForSubscriptions(
                        subscription.topicNames,
                        subscription.queueName,
                        subscription.filter,
                        acb
                    );
                } else {
                    acb();
                }
            }
        ],
        function (err) {

            if (err) {
                cb(err);
                return;
            }

            cb();

        });
}

module.exports.createSubscription = createSubscription;


/**
 * Takes an array of subscriptions (see createSubscription() for details) and
 * creates a subscription for each one.
 *
 * @param subscriptions
 * @param cb
 */
function createSubscriptions(subscriptions, cb) {

    async.each(subscriptions, createSubscription, function (err) {

        if (err) {
            cb(err);
            return;
        }

        cb();

    });
}

module.exports.createSubscriptions = createSubscriptions;


function getEnvironmentName(cb) {

    if (environmentName) {
        cb(null, environmentName);
        return;
    }

    //Allow setting this explicitly.
    if (process.env.ENVIRONMENT_NAME) {
        environmentName = process.env.ENVIRONMENT_NAME;
        cb(null, environmentName);
        return;
    }

    const params = {
        accountName: 'voyent',
        realmName: 'platform.services'
    };

    scopes.getEnvironmentAttribute(params, 'voyent_config')
        .then(function (voyentConfig) {

            const host = ld.get(voyentConfig, 'default.host');

            if (!host) {
                cb(new Error('cannot find voyent_config.default.host in environment scope'));
                return;
            }

            environmentName = host;
            const firstDot = host.indexOf('.');

            if (firstDot > 0) {
                environmentName = host.substring(0, host.indexOf('.'));
            }

            if (environmentName.length > 12) {
                environmentName = environmentName.substring(0, 11);
            }

            cb(null, environmentName);
        })
        .catch(function (err) {
            cb(err);
        });
}

function getServiceName() {

    if (!serviceName) {
        serviceName = process.env.SERVICE_NAME || "SERVICE_NAME_UNKNOWN";
    }

    if (serviceName.length > 24) {
        serviceName = serviceName.substring(0, 23);
    }

    return serviceName;
}

module.exports.getServiceName = getServiceName;


function getQualifiedTopicName(topicName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    getEnvironmentName(function (err, eName) {

        if (err) {
            cb(err);
            return;
        }

        let qualifiedTopicName = eName + '_' + topicName;
        cb(null, qualifiedTopicName);
    });
}

module.exports.getQualifiedTopicName = getQualifiedTopicName;


function getQualifiedQueueName(topicName, queueName, cb) {

    if (!isValidTopicName(topicName)) {
        cb(new Error('topic name is invalid ' + topicName));
        return;
    }

    if (!isValidQueueName(queueName)) {
        cb(new Error('queue name is invalid ' + queueName));
        return;
    }

    getQualifiedTopicName(topicName, function (err, tName) {

        if (err) {
            cb(err);
            return;
        }

        let qualifiedQueueName =
            tName + '_' +
            getServiceName() + '_' +
            queueName;

        cb(null, qualifiedQueueName);

    });

}

module.exports.getQualifiedQueueName = getQualifiedQueueName;


// -------------------------------------
// FUNCTIONS FOR BACKWARDS COMPATIBILITY
// -------------------------------------
//
// The following functions were copied from the older events.js library and
// modified to work with the new messaging system to help ease the migration.

/**
 * Create a valid event object form the supplied parameters.
 *
 * @param account {String}  The name of the account. Required.
 * @param realm {String}    The name of the realm. Required
 * @param service {String}  The name of the service (e.g. docs). Required.
 * @param event {String}    The name of the event (e.g. create). Required
 * @param type {String}     The type of the resource (e.g. blob, doc, location, etc.). Required.
 * @param username {String} The name of the user that initiated the event. Required.
 * @param data {Object}     Custom data for this event, specific to the service that published it.  Optional.
 * @param time {String}     Custom date/time represented in ISO 8601 UTC format (YYYY-MM-DDTHH:mm:ss.sssZ), if not provided the current time will be used. Optional.
 * @param txcode {String}   The relevant request transaction code. Optional.
 * @returns {Object}        A standard event object created from the parameters.
 */
function createEvent(account, realm, service, event, type, username, data, time, txcode) {

    const logger = require('./loggers').getLogger();

    if (arguments.length < 6 || arguments.length > 9) {
        logger.warn('could not create event, should have 6-9 arguments', arguments.length);
        return null;
    }

    let officialEvent = {
        "time": time ? time : new Date().toISOString(),
        "account": account,
        "realm": realm,
        "service": service,
        "event": event,
        "type": type,
        "username": username
    };

    if (txcode) {
        officialEvent.tx = txcode;
    }

    officialEvent.data = data || {};

    return officialEvent;
}

module.exports.createEvent = createEvent;


/**
 * A barrel typically contains all the information required to create an event so
 * this function is a convenience that pulls the relevant info and then calls through
 * to createEvent(account, realm, service, event, type, username, data, time, tx).
 *
 * @param barrel {Object}  The general container for all properties carried through a
 *                         services waterfall of functions.
 * @returns {Object}       A standard event object created from the barrel.
 */
function createEventFromBarrel(barrel) {

    const logger = require('./loggers').getLogger();

    logger.debug('creating service event from barrel');

    //First check to see if barrel is missing any required information.
    let paramErrors = [];
    if (!barrel.account && !barrel.accountId) {
        paramErrors.push('barrel.account or barrel.accountId');
    }

    if (!barrel.realmId) {
        paramErrors.push('barrel.realmId');
    }

    if (!getServiceName()) {
        paramErrors.push('config.service.name');
    }

    if (!barrel.serviceEvent) {
        paramErrors.push('barrel.serviceEvent');
    }

    if (!barrel.resourceType) {
        paramErrors.push('barrel.resourceType');
    }

    if (!barrel.username) {
        paramErrors.push('barrel.username');
    }

    if (paramErrors.length > 0) {
        logger.warn('missing parameters to create event = ', paramErrors);
        return null;
    }

    //Then massage the information we have so that we can create an event.
    const account = barrel.account || barrel.accountId;

    let customData = barrel.serviceEventData || {};

    if (barrel.validatedResourceId || barrel.resourceId) {
        customData.resourceId = barrel.validatedResourceId || barrel.resourceId;
    }
    if (barrel.req && barrel.req.headers && barrel.req.headers.host) {
        customData.origin = barrel.req.headers.host;
    }
    if (barrel.startTime) {
        customData.processTime = new Date().getTime() - barrel.startTime;
    }

    let theEvent = createEvent(
        account,
        barrel.realmId,
        getServiceName(),
        barrel.serviceEvent,
        barrel.resourceType,
        barrel.username,
        customData,
        null,
        barrel.meta && barrel.meta.tx ? barrel.meta.tx : null
    );

    if (barrel.req) {
        const processId = tools.getProcessId(barrel.req);
        if (processId) {
            theEvent.processId = processId;
        }
    }

    return theEvent;
}

module.exports.createEventFromBarrel = createEventFromBarrel;


/**
 * Publishes a message to the specified topic.
 *
 * @param topic {String} A hierarchical topic string that follows a set pattern
 *                       (e.g. events/myaccount/myrealm/docs/create).
 * @param message {String} The message to publish.  If an Object is provided, it
 *                         will be converted to a String.
 *
 */
function publishMessage(topic, message) {
    publishEventToTopic(topic, message);
}

module.exports.publishMessage = publishMessage;


/**
 * Convenience method for publishing a service event.  For details of required
 * and optional properties of the event, see createEvent().
 *
 * @param event
 */
function publishServiceEvent(event) {
    publishEventToServiceTopic(event);
}

module.exports.publishServiceEvent = publishServiceEvent;


/**
 * Convenience method for publishing a service event based on the information in a barrel.  For details
 * of required and optional properties of the event, see createEvent().
 *
 * @param barrel
 */
function publishServiceEventFromBarrel(barrel) {
    let event = createEventFromBarrel(barrel);
    publishServiceEvent(event);
}

module.exports.publishServiceEventFromBarrel = publishServiceEventFromBarrel;


/**
 * Convenience method for publishing a service event based a validated resource in a barrel. For details
 * of required and optional properties of the event, see createEvent().
 *
 * @param barrel
 */
function publishCustomEventFromBarrel(barrel) {
    let event = createCustomEventFromBarrel(barrel);
    publishServiceEvent(event);
}

module.exports.publishCustomEventFromBarrel = publishCustomEventFromBarrel;

/**
 * A barrel typically contains all the information required to create an event
 * so this function is a convenience that pulls the relevant info and then calls
 * through to createEvent(account, realm, service, event, type, username, data,
 * time, tx). This function focuses on grabbing data from a validated resource
 * in the barrel.
 *
 * @param barrel {Object}  The general container for all properties carried
 *                         through a services waterfall of functions.
 * @returns {Object}       A standard event object created from the barrel.
 */
function createCustomEventFromBarrel(barrel) {

    const logger = require('./loggers').getLogger();
    logger.debug('creating custom event from validatedResource in barrel');

    //First check to see if barrel is missing any required information.
    let paramErrors = [];
    if (!barrel.account && !barrel.accountId) {
        paramErrors.push('barrel.account or barrel.accountId');
    }

    if (!barrel.realmId) {
        paramErrors.push('barrel.realmId');
    }

    if (!barrel.validatedResource.service) {
        paramErrors.push('barrel.validatedResource.service');
    }

    if (!barrel.validatedResource.event) {
        paramErrors.push('barrel.validatedResource.event');
    }

    if (!barrel.validatedResource.type) {
        paramErrors.push('barrel.validatedResource.type');
    }

    if (!barrel.username) {
        paramErrors.push('barrel.username');
    }

    if (paramErrors.length > 0) {
        logger.warn('missing parameters to create event = ', paramErrors);
        return null;
    }

    //Then massage the information we have so that we can create an event.
    const account = barrel.account || barrel.accountId;

    let customData = barrel.validatedResource.data || {};

    if (barrel.req && barrel.req.headers && barrel.req.headers.host) {
        customData.origin = barrel.req.headers.host;
    }
    if (barrel.startTime) {
        customData.processTime = new Date().getTime() - barrel.startTime;
    }

    let theEvent = createEvent(
        account,
        barrel.realmId,
        barrel.validatedResource.service,
        barrel.validatedResource.event,
        barrel.validatedResource.type,
        barrel.username,
        customData,
        barrel.validatedResource.time ? barrel.validatedResource.time : new Date().toISOString(),
        barrel.meta && barrel.meta.tx ? barrel.meta.tx : null);

    const processId = tools.getProcessId(barrel.req);

    if (processId) {
        theEvent.processId = processId;
    }

    return theEvent;
}

module.exports.createCustomEventFromBarrel = createCustomEventFromBarrel;
