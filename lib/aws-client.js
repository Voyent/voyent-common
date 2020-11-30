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

//Determine how AWS services are being provided.  When running locally, we
//use localstack.  When running on AWS, we use the actual AWS services.
const awsProvider = process.env.AWS_PROVIDER || 'amazon';
console.log('AWS provider is [' + awsProvider + ']');


function resolveLocalStackClients() {

    clients.awsRegion = process.env.AWS_REGION || 'ca-central-1';

    //For localstack, we can just use fake credentials as it doesn't do any
    //real verification.
    let credentials = new AWS.Credentials({
        accessKeyId: 'dummyAccessKey',
        secretAccessKey: 'dummySecret',
        sessionToken: 'dummySessionToken'
    });

    AWS.config.update({
        region: awsRegion,
        credentials: credentials,
        s3ForcePathStyle: true
    });

    //The endpoints for the various services need to be set to match what the
    //local Docker network will be exposing, which is the service name.
    clients.s3 = new AWS.S3({endpoint: "http://aws:4572"});
    clients.sns = new AWS.SNS({endpoint: "http://aws:4575"});
    clients.sqs = new AWS.SQS({endpoint: "http://aws:4576"});

    console.log('AWS region (from env) is [' + clients.awsRegion + ']');
}


function resolveOfficialClients(cb) {

    clients.awsRegion = process.env.AWS_REGION || 'ca-central-1';

    const agent = require('superagent');
    const ld = require('lodash');

    //This is how AWS currently recommends to get the identity information for
    //the instance this container is running on.
    const url = 'http://169.254.169.254/latest/dynamic/instance-identity/document';

    agent.get(url)
        .end(function (err, response) {

            if (err) {
                return cb(err);
            }

            if (!response || !response.text) {
                console.log('did not receive a valid response');
                return cb(new Error('did not receive a valid response'));
            }

            let parsedReponse = {};

            try {
                parsedReponse = JSON.parse(response.text);
            } catch (e) {
                console.log('could not parse response', response.text);
                return cb(new Error('could not parse response'));
            }

            clients.awsRegion = ld.get(parsedReponse, 'region');

            if (!clients.awsRegion) {
                console.log('could not extract a valid region', response.text, parsedReponse);
                return cb(new Error('could not extract a valid region'));
            }

            //When using the real AWS service, the credentials are provided to the
            //Docker container so we don't need to set them explicitly.  We still
            //do the region though.
            AWS.config.update({
                region: clients.awsRegion
            });

            clients.s3 = new AWS.S3();
            clients.sns = new AWS.SNS();
            clients.sqs = new AWS.SQS();

            console.log('AWS region (from identity file) is [' + clients.awsRegion + ']');

            cb(null, clients);

        });

}

//Object for the aws-sdk clients.
let clients;

/**
 * Clients are set depending on whether we are running against localstack or
 * actual AWS endpoints.  If they have already been set, then we just use the
 * existing values.
 */
function getClients(cb) {

    if (clients) {
        // console.log('using cached AWS clients', awsProvider, clients.awsRegion);
        return cb(null, clients);
    }

    clients = {};

    //Setting up the AWS SDK is slightly different depending on if we are running
    //locally using localstack or against the real AWS service.
    if (awsProvider === 'localstack') {
        resolveLocalStackClients();
        return cb(null, clients);
    }

    resolveOfficialClients(function (err) {
        if (err) {
            return cb(err);
        }
        cb(null, clients);
    });
}


module.exports.getClients = getClients;