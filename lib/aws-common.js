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

const AWS = require('aws-sdk');
const async = require('async');
const ld = require('lodash');

// const config =
const scopes = require('./scopes');
const tools = require('./tools');

let environmentName;
let serviceName;

//Some localstack calls won't work if you don't use a valid region, even though
//when running a mock local set of service, the region doesn't really make a
//difference.  In any case, we'll just set the region from the provided env
//variable or set a reasonable default.
const awsRegion = process.env.AWS_REGION || 'ca-central-1';
AWS.config.update({region: awsRegion});

//You can turn on some localstack logging by uncommenting the following.
// AWS.config.logger = console;

//Variables for the aws-sdk APIs.  They are set below depending on whether we
//are running against localstack or actual AWS endpoints.
let s3;
let sns;
let sqs;

//Determine how AWS services are being provided.  When running locally, we
//use localstack.  When running on AWS, we use the actual AWS services.
const awsProvider = process.env.AWS_PROVIDER || 'amazon';
console.log('AWS provider is [' + awsProvider + ']');

//Configure the AWS client to reflect with AWS APIs we are using.  Running
//locally means a locally mocked version of AWS based on localstack.
if (awsProvider === 'localstack') {
    s3 = new AWS.S3({endpoint: "http://localhost:4572"});
    sns = new AWS.SNS({endpoint: "http://localhost:4575"});
    sqs = new AWS.SQS({endpoint: "http://localhost:4576"});
} else {
    s3 = new AWS.S3();
    sns = new AWS.SNS();
    sqs = new AWS.SQS();
}

module.exports.s3 = s3;
module.exports.sns = sns;
module.exports.sqs = sqs;


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

    getQualifiedQueueName(topicName, queueName, function (err, qName) {

        if (err) {
            cb(err);
            return;
        }

        const params = {
            QueueName: qName,
            Attributes: {
                MessageRetentionPeriod: "86400",
                ReceiveMessageWaitTimeSeconds: "20",
                VisibilityTimeout: "2"
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

    getQualifiedTopicName(topicName, function (err, tName) {

        if (err) {
            cb(err);
            return;
        }

        sns.listTopics({}, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            let topicArn = ld.find(data.Topics, function (item) {
                return item.TopicArn.endsWith(':' + tName);
            });

            if (!topicArn) {
                cb(new Error('cannot get ARN for ' + topicName));
                return;
            }

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

        sqs.listQueues({}, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            let queueUrl = ld.find(data.QueueUrls, function (item) {
                return item.endsWith(qName);
            });

            cb(null, queueUrl);

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


function convertPropertyToAttribute(key, value) {

    let result = {};

    if (ld.isString(value)) {

        result[key] = {
            DataType: "String",
            StringValue: value
        };

    }

    if (ld.isNumber(value)) {
        result[key] = {
            DataType: "Number",
            StringValue: value.toString()
        };
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

    let attrs = {};

    ld.forEach(event, function (val, key) {

        if (ld.isObject(val)) {

            ld.forEach(val, function (val2, key2) {
                let nestedKey = key + '_' + key2;
                attrs[nestedKey] = convertPropertyToAttribute(key2, val2)[key2];
            });

        } else {
            attrs[key] = convertPropertyToAttribute(key, val)[key];
        }

    });

    return attrs;

}

module.exports.convertEventToMessageAttributes = convertEventToMessageAttributes;


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

            cb(null, data);
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
            logger.error('problem publishing message', err.message);
            return;
        }

        logger.debug('published event to', topicName, JSON.stringify(data));
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
function subscribeQueueToTopic(topicName, queueName, cb) {

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
            getQueueArn(topicName, queueName, acb);
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
 * Set a filter on a subscription.  When you subscribe a queue to a topic, the
 * relationship is recorded under a subscription ARN.
 *
 * @param topicName
 * @param queueName
 * @param filter
 * @param cb
 */
function setFilterForSubscription(topicName, queueName, filter, cb) {

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
            getQueueArn(topicName, queueName, acb);
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
 * A subscription is made up of a topic name, a queue, and an optional filter:
 *
 * {
 *     topicName: "myTopicName",
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
 * This function creates the topic, queue, and subscription as required and then
 * applies the filter policy to the subscription making it easier for services
 * to do the setup required.
 *
 * @param subscription
 * @param subscription.topicName
 * @param subscription.queueName
 * @param subscription.filter
 * @param cb
 */
function createSubscription(subscription, cb) {

    async.waterfall(
        [
            function (acb) {
                createTopic(subscription.topicName, acb);
            },
            function (results, acb) {
                createQueue(subscription.topicName, subscription.queueName, acb);
            },
            function (results, acb) {
                subscribeQueueToTopic(
                    subscription.topicName,
                    subscription.queueName,
                    acb
                );
            },
            function (results, acb) {

                if (subscription.filter) {
                    setFilterForSubscription(
                        subscription.topicName,
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

    //Allow setting this explicitly for development/testing purposes.
    if (process.env.AWS_ENVIRONMENT_NAME) {
        environmentName = process.env.AWS_ENVIRONMENT_NAME;
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

    var theEvent = createEvent(
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

    if(processId){
        theEvent.processId = processId;
    }

    return theEvent;
}

module.exports.createCustomEventFromBarrel = createCustomEventFromBarrel;
