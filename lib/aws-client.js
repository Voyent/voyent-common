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
        credentials: credentials,
        s3ForcePathStyle: true
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
