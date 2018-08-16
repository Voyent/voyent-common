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

/**
 * The runtime environment properties are stored in AWS S3 buckets.  The goal of
 * this module is to pull all the relevant properties for a service and convert
 * them into a JS object suitable for use in our Node-based services.
 */

const ld = require('lodash');
const async = require('async');
const os = require('os');

const AWS = require('aws-sdk');
const s3 = new AWS.S3();


//An object to store all the environment properties.
let environmentProperties = {
    MSGS_NAME: '_' + os.hostname()
};

//The bucket name should be set as an environment variable.
const bucketName = process.env.SECRETS_BUCKET_NAME;

/**
 * The SECRETS_BUCKET_NAME env variable must be set in order for services
 * to know which AWS S3 bucket to use.  This should be passed in by whatever
 * mechanism is used to run the Docker environment.  For example, locally it
 * is likely to be docker-compose.yml file.  On AWS, it will be the Task
 * definition.
 *
 */
function verifyBucket(cb) {

    if (!bucketName) {
        cb(new Error("missing SECRETS_BUCKET_NAME environment variable"));
        return;
    }

    var params = {
        Bucket: bucketName
    };

    s3.headBucket(params, function (err, data) {

        if (err) {
            cb(err);
            return;
        }

        cb();
    });

}

/**
 * Gets the object in the S3 bucket associated with the specified key.
 *
 * @param key
 * @param cb
 */
function getBucketObject(key, cb) {

    // const logger = require('./loggers').getLogger();

    let params = {
        Bucket: bucketName,
        Key: key
    };

    s3.getObject(params, function (err, data) {

        if (err) {

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


function processBucketValues(configFileNames, cb) {

    //If we have some config files and a valid bucket, we can pull the bucket
    //values out and process them.

    let allConfigs = [];

    async.each(
        configFileNames,
        function (configFile, acb) {

            getBucketObject(configFile, function (err, data) {

                if (err) {
                    acb(err);
                    return;
                }

                if (!data || !data.Body) {
                    console.warn(bucketName, 'has no key', configFile);
                    acb();
                    return;
                }

                let propString = data.Body.toString();

                allConfigs.push(convertPropertiesToObject(propString));
                acb();

            });
        }, function (err) {

            if (err) {
                cb(err);
                return;
            }

            ld.forEach(allConfigs, function (config) {
                ld.merge(environmentProperties, config);
            });

            console.log('returning new properties');
            cb();

        });

}

/**
 * Initial the runtime environment properties object.  The typical use is to
 * provide the names of the config files which are the "keys" in the S3 bucket.
 * This function gets the data associated with the file keys and converts them
 * into a JS object.
 *
 * Our typical approach is to have:
 *
 * - One file that contains properties that are common to all services called
 *   common.config.
 *
 * - One file specific to the service that contains information that only that
 *   service cares about (e.g. action-service-node.config).
 *
 * To initialize the environment properties for Auth you'd then call this
 * function with an array of the file names and a callback handler function:
 *
 * - initEnvironmentProperties(
 *     ['common.config',
 *      'auth-service-node.config'],
 *     function(err,props){}
 *   )
 *
 * Once initialized, you can get all the properties or a single one using
 * the other functions.
 *
 * @param configFileNames
 * @param cb
 */
function initEnvironmentProperties(configFileNames, cb) {

    //If there are no config file names, then just return the default
    //properties.
    if (!configFileNames || ld.isEmpty(configFileNames)) {
        cb(null, environmentProperties);
        return;
    }

    //Check to see that the bucket exists and we can access it.  If not, then
    //return the default properties.
    verifyBucket(function (err) {

        if (err) {
            console.log(bucketName, err.message || err.code);
            cb(null, environmentProperties);
            return;
        }

        processBucketValues(configFileNames, function (err) {

            if (err) {
                cb(err);
                return;
            }

            cb();
        });

    });


}

module.exports.initEnvironmentProperties = initEnvironmentProperties;


/**
 * Gets the full environment properties object as it's currently configured.
 *
 * @returns The environment properties object.
 */
function getEnvironmentProperties() {
    return environmentProperties;
}

module.exports.getEnvironmentProperties = getEnvironmentProperties;

/**
 * Retrieves the value associated with the environment property.
 *
 * @returns The value associated with the environment property key.
 */
function getEnvironmentProperty(key) {
    return ld.get(environmentProperties, key);
}

module.exports.getEnvironmentProperty = getEnvironmentProperty;
