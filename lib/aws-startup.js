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

const async = require('async');
const ld = require('lodash');
const awsClient = require('./aws-client');

/**
 * The SECRETS_BUCKET_NAME env variable must be set in order for services
 * to know which AWS S3 bucket to use.  This verifies that the bucket with the
 * provided name exists and can be accessed.
 *
 */
// function verifyBucket(bucketName, cb) {
//
//     if (!bucketName) {
//         cb(new Error("missing SECRETS_BUCKET_NAME environment variable"));
//         return;
//     }
//
//     let params = {
//         Bucket: bucketName
//     };
//
//     awsClient.s3.headBucket(params, function (err) {
//
//         if (err) {
//             console.log('aws-startup','problem verifying bucket', bucketName, err);
//             cb(err);
//             return;
//         }
//
//         cb();
//     });
// }

/**
 * Checks to make sure that the specified config file names exist in the
 * specified bucket.
 *
 */
// function getConfigFilenames(bucketName, cb) {
//
//     let params = {
//         Bucket: bucketName
//     };
//
//     awsClient.s3.listObjectsV2(params, function (err, data) {
//
//         if (err) {
//             console.log('aws-startup','problem listing objects', bucketName, err);
//             cb(err);
//             return;
//         }
//
//         //From the list of Contents in the bucket, get all the keys that end
//         //with ".config".
//         let configFilenames = [];
//         ld.each(ld.get(data, 'Contents'), function (meta) {
//             let key = ld.get(meta, 'Key');
//             if (key && key.endsWith('.config')) {
//                 configFilenames.push(key);
//             }
//         });
//
//         cb(null, configFilenames);
//     });
//
// }

/**
 * Gets the object in the S3 bucket associated with the specified key.
 *
 * @param bucketName
 * @param key
 * @param cb
 */
function getBucketObject(bucketName, key, cb) {

    // const logger = require('./loggers').getLogger();

    let params = {
        Bucket: bucketName,
        Key: key
    };

    awsClient.s3.getObject(params, function (err, data) {

        if (err) {

            console.log('aws-startup','problem getting object', bucketName, key, err);

            if (err.code === "NoSuchKey") {
                cb();
            } else {
                cb(err);
            }
            return;
        }

        cb(null, data);
    });
}

/**
 * We store the bucket values in key=value format (e.g. like Java properties).
 * To use them in Node, we convert them to an object.
 *
 * When we get the contents of a bucket, it comes in one big string.  This
 * utility method takes the large string and parses it down into a JS object
 * that we can use more easily.
 *
 * @param propString
 */
function convertPropertiesToObject(propString) {

    //Assume each separate line is a property string
    const lines = propString.split("\n");

    let config = {};
    ld.forEach(lines, function (line) {

        if (line.trim().length === 0) {
            return;
        }

        line = line.replace(/"/g, '');

        const firstEqual = line.indexOf('=');
        const key = line.substring(0, firstEqual).trim();
        const val = line.substring(firstEqual + 1).trim();

        config[key] = val;

    });

    return config;
}

/**
 * Given an array of one or more filenames, retrieves their values from the
 * bucket with the provided name.  For each config file, it processes the values
 * to convert them from Java-style properties to JSON formats.
 *
 * @param bucketName
 * @param configFileNames
 * @param cb
 */
function getAndMergeProperties(bucketName, keys, cb) {

    //If we have some config files and a valid bucket, we can pull the bucket
    //values out and process them.

    let allConfigs = [];

    async.each(
        keys,
        function (key, acb) {

            getBucketObject(bucketName, key, function (err, data) {

                if (err) {
                    console.log('aws-startup','problem getting bucket object', bucketName, key, err);
                    acb(err);
                    return;
                }

                if (!data || !data.Body) {
                    console.warn(bucketName, 'does not have key', key);
                    acb();
                    return;
                }

                let propString = data.Body.toString();

                allConfigs.push(convertPropertiesToObject(propString));
                acb();

            });
        }, function (err) {

            if (err) {
                console.log('aws-startup','problem getting and merging properties', bucketName, err);
                cb(err);
                return;
            }

            let mergedProps = {};

            ld.forEach(allConfigs, function (config) {
                ld.merge(mergedProps, config);
            });

            cb(null, mergedProps);

        });
}


let environmentProperties;

/**
 * Initial the runtime environment properties object.  It verifies that the
 * bucked specified by the SECRETS_BUCKET_NAME env variable exists and then
 * reads all the files that end with "*.config", converts the properties and
 * sets them as environment variables.  This needs to be done before anything
 * else that might depend on the environment properties, primarily the DB_URI
 * needed to establish database connections.
 *
 * @param cb
 */
function loadEnvironmentProperties(keys, cb) {

    const bucketName = process.env.SECRETS_BUCKET_NAME;

    async.waterfall([

        //For each key, get the properties, parse them, and merge
        //them together in a Javascript object.
        function (wcb) {
            getAndMergeProperties(bucketName, keys, wcb);
        },

        function (allProps, wcb) {

            //Set each property as an "real" environment variable
            ld.each(allProps, function (val, key) {
                process.env[key] = val;
            });

            wcb(null, allProps);

        },

    ], function (err, results) {

        if (err) {
            cb(err);
            return;
        }

        environmentProperties = ld.assign(environmentProperties, results);
        cb(null, environmentProperties);

    });

}

module.exports.loadEnvironmentProperties = loadEnvironmentProperties;