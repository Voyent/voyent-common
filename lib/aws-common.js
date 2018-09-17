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

//Some localstack calls won't work if you don't use a valid region, even though
//when running a mock local set of service, the region doesn't really make a
//difference.  In any case, we'll just set the region as we'd expect it to be
//set in a real environment.
AWS.config.update({region: 'ca-central-1'});

//You can turn on some localstack logging by uncommenting the following.
// AWS.config.logger = console;

//Variables for the aws-sdk APIs.  They are set below depending on whether we
//are running against localstack or actual AWS endpoints.
let s3;
let sns;
let sqs;

//By default, we'd normally set this to amazon so that we use the "real"
//services.  But while I'm working on it, it's easier to have the default
//be localstack.
const awsProvider = process.env.AWS_PROVIDER || 'localstack';
// const awsProvider = process.env.AWS_PROVIDER || 'amazon';

//Configure the AWS client to reflect with AWS APIs we are using.  Running
//locally means a locally mocked version of AWS based on localstack.
if (awsProvider === 'localstack') {
    console.log('setting localstack endpoints for AWS');
    s3 = new AWS.S3({endpoint: "http://localhost:4572"});
    sns = new AWS.SNS({endpoint: "http://localhost:4575"});
    sqs = new AWS.SQS({endpoint: "http://localhost:4576"});
} else {
    console.log('setting amazon endpoints for AWS');
    s3 = new AWS.S3();
    sns = new AWS.SNS();
    sqs = new AWS.SQS();
}

module.exports.s3 = s3;
module.exports.sns = sns;
module.exports.sqs = sqs;


function getQueuePolicy(queueName) {

    return {
        "Version": "2012-10-17",
        "Id": "arn:aws:sqs:ca-central-1:983435553210:" + queueName + "/SQSDefaultPolicy",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "AWS": "*"
                },
                "Action": "SQS:SendMessage",
                "Resource": "arn:aws:sqs:ca-central-1:983435553210:" + queueName,
                "Condition": {
                    "ArnEquals": {
                        "aws:SourceArn": "arn:aws:sns:ca-central-1:983435553210:*"
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
 * @param name
 * @param cb
 */
function createQueue(name, cb) {

    if (!name) {
        cb(new Error('no queue name provided'));
        return;
    }

    const params = {
        QueueName: name,
        Attributes: {
            MessageRetentionPeriod: "86400",
            ReceiveMessageWaitTimeSeconds: "20",
            VisibilityTimeout: "2",
            Policy: JSON.stringify(getQueuePolicy(name))
        }
    };

    sqs.createQueue(params, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        console.log('createQueue', 'done', data);
        cb(null, data);

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
 * @param name
 * @param cb
 */
function deleteQueue(name, cb) {

    if (!name) {
        cb(new Error('no queue name provided'));
        return;
    }

    getQueueUrl(name, function (err, qURL) {

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

            console.log('deleteQueue', 'done', data);
            cb(null, data);

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
 * @param name
 * @param cb
 */
function createTopic(name, cb) {

    if (!name) {
        cb(new Error('no topic name provided'));
        return;
    }

    const params = {
        Name: name
    };

    sns.createTopic(params, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        console.log('createTopic', 'done', data);
        cb(null, data);

    });

}

module.exports.createTopic = createTopic;


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
 * @param name
 * @param cb
 */
function deleteTopic(name, cb) {

    if (!name) {
        cb(new Error('no topic name provided'));
        return;
    }

    getTopicArn(name, function (err, topicArn) {

        const params = {
            TopicArn: topicArn
        };

        sns.deleteTopic(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            console.log('deleteTopic', 'done', data);
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

    sns.listTopics({}, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        // console.log('getTopicARN', data);

        let topicArn = ld.find(data.Topics, function (item) {
            return item.TopicArn.endsWith(':' + topicName);
        });

        cb(null, topicArn.TopicArn);

    });

}

module.exports.getTopicArn = getTopicArn;


/**
 * Use the provided queue name to get the official queue URL.
 *
 * @param queueName
 * @param cb
 */
function getQueueUrl(queueName, cb) {

    sqs.listQueues({}, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        let queueUrl = ld.find(data.QueueUrls, function (item) {
            return item.endsWith(queueName);
        });

        cb(null, queueUrl);

    });

}

module.exports.getQueueUrl = getQueueUrl;


/**
 * Use the provided queue name to get the official queue ARN.
 *
 * @param queueName
 * @param cb
 */
function getQueueArn(queueName, cb) {

    getQueueUrl(queueName, function (err, qURL) {

        if (err) {
            cb(err);
            return;
        }

        if (!qURL) {
            cb(new Error('queue does not exist ' + queueName));
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
                cb(new Error('cannot get attributes for queue ' + queueName));
                return;
            }

            cb(null, ld.get(data, 'Attributes.QueueArn'));

        });

    });


}

module.exports.getQueueArn = getQueueArn;


/**
 * Given a Voyent event, convert the event properties to a set of valid topic
 * message attributes.  Top-level attributes are converted to Strings.  For the
 * data property, the nested object properties are not converted.  Instead, the
 * entire nested object is converted to a single String and saved under data.
 *
 * @param event
 */
function convertEventToMessageAttributes(event) {

    let attrs = {};

    ld.forEach(event, function (val, key) {

        attrs[key] = {
            DataType: "String",
            StringValue: val
        };

        if (key === "data") {
            attrs.data.StringValue = JSON.stringify(val);
        }
    });

    return attrs;

}

module.exports.convertEventToMessageAttributes = convertEventToMessageAttributes;


/**
 * This does the opposite of the convertEventToMessageAttributes() function.  It
 * turns the message retrieved from the queue and turns it back into a Voyent
 * event object.
 *
 * @param message
 */
function convertMessageAttributesToEvent(message) {

    // console.log('convertMessageAttributesToEvent', JSON.stringify(message,null,4))

    if (!message || !message.Body) {
        return;
    }

    let body = {};
    try {
        body = JSON.parse(message.Body);
    } catch (e) {
        console.log('problem parsing message body', e);
        return;
    }

    let event = {};
    ld.forEach(body.MessageAttributes, function (val, key) {

        event[key] = val.Value;

        if (key === "data") {
            try {
                event[key] = JSON.parse(val.Value);
            } catch (e) {
                console.log('problem parsing data property', val.Value, e);
                event[key] = {};
            }
        }
    });

    return event;

}

module.exports.convertMessageAttributesToEvent = convertMessageAttributesToEvent;


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

    message = message || 'No message provided.';
    attrs = attrs || {};

    getTopicArn(topicName, function (err, topicArn) {

        if (err) {
            cb(err);
            return;
        }

        const params = {
            Message: message,
            MessageAttributes: attrs,
            TargetArn: topicArn
        };

        // console.log('publishing', JSON.stringify(params, null, 4));

        sns.publish(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            // console.log('published message', JSON.stringify(data, null, 4));
            cb(null, data);
        });
    });

}

module.exports.publishMessageToTopic = publishMessageToTopic;


/**
 * Sends a message to the named queue.  This is generally not done directly and
 * is mostly here for test/future purposes.  Normally messages would be published
 * to topics which would then send the messages to any subscibed queues.
 *
 * @param queueName
 * @param message
 * @param cb
 */
function sendMessageToQueue(queueName, message, cb) {

    getQueueUrl(queueName, function (err, queueUrl) {

        if (err) {
            cb(err);
            return;
        }

        const params = {
            MessageBody: message,
            QueueUrl: queueUrl,
            DelaySeconds: 0
        };

        console.log('sending', JSON.stringify(params, null, 4));

        sqs.sendMessage(params, function (err, data) {

            if (err) {
                cb(err);
                return;
            }

            console.log('sent message result', JSON.stringify(data, null, 4));
            cb();
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

    async.parallel({
        topicArn: function (cb) {
            getTopicArn(topicName, cb);
        },
        queueArn: function (cb) {
            getQueueArn(queueName, cb);
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
                    console.log('queue', results.queueArn,
                        'already subscribed to', results.topicArn);
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

                    console.log('queue', results.queueArn, 'subscribed to', results.topicArn);
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

    async.parallel({
        topicArn: function (cb) {
            getTopicArn(topicName, cb);
        },
        queueArn: function (cb) {
            getQueueArn(queueName, cb);
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
                    console.log('queue', results.queueArn,
                        'not subscribed to', results.topicArn);
                    cb();
                    return;
                }

                console.log('found subscription', JSON.stringify(sub, null, 4));

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

                    console.log('filter set for', queueName, 'subscribed to', topicName);
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
                createQueue(subscription.queueName, acb);
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
