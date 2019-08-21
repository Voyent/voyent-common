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
 * Copyright 2009-2013 ICEsoft Technologies Canada, Corp. All Rights Reserved.
 */

var config = require('./config');
var winston = require('winston');
var us = require('underscore');
var CustomLogger = require('./customLogger').CustomLogger;
var ld = require('lodash');

// Get the appropriate logger based on the strategy provided in the config
// file or by setting an environment variable. By default, the legacy logger
// is used.  Setting the logging strategy to "fluent" will return a Winston
// logger sends modified log statements to the console which are channelled
// to the Fluent log aggregator and eventually stored in Mongo.
module.exports.getLogger = function getLogger(userOptions) {

    if (config.logging.strategy === 'fluent' ||
        process.env.VOYENT_LOGGING_STRATEGY === 'fluent') {
        return getFluentLogger(userOptions);
    }

    return getLegacyLogger(userOptions);
};

// This logger is the original way we do things.  It's probably still useful
// when running Docker locally as it doesn't modify anything and doesn't stuff
// anything into Mongo.
function getLegacyLogger(userOptions) {

    var settings = config.logging.defaults;
    if (userOptions) {
        settings = us.extend(config.logging.defaults, userOptions);
    }
    if (!winston.loggers.has(settings.logName)) {

        var consoleConfig = {
            level: settings.logLevel,
            silent: false,
            colorize: false,
            timestamp: true
        };
        winston.loggers.options.transports = [
            // Setup your shared transports here
            new (winston.transports.Console)(consoleConfig),
        ];

        //Only add the logger instance if we don't already have one by that name
        winston.loggers.add(settings.logName, {});
    }

    var theLogger = winston.loggers.get(settings.logName);

    return theLogger;
}

// This logger is simpler in that it only logs to the console.  In a Docker
// environment, these logs are forward to the Fluent service, aggregated, and
// stored wherever Fluent is configured to store them - typically MongoDB.  It
// also does a bit of pre-processing to try and make the whole thing into a
// parsable JSON document that can be stored more effectively in Mongo.
function getFluentLogger(userOptions) {

    var settings = config.logging.defaults;
    if (userOptions) {
        settings = us.extend(config.logging.defaults, userOptions);
    }
    if (!winston.loggers.has(settings.logName)) {

        var consoleConfig = {
            level: settings.logLevel,
            json: false,
            prettyPrint: false,
            stringify: true,
            stderrLevels: ['error'],
            formatter: function (options) {
                const logResult = {
                    level: options.level,
                    message: (options.message ? options.message : ''),
                    data: options.meta
                };
                return JSON.stringify(logResult);
            }
        };

        winston.loggers.options.transports = [new (winston.transports.Console)(consoleConfig)];

        //Only add the logger instance if we don't already have one by that name
        winston.loggers.add(settings.logName, {});
    }

    var theLogger = winston.loggers.get(settings.logName);

    //This facade acts a pre-processor.  It's main purpose is to gather
    //all the arguments that are objects (rather than just strings), and
    //accumulate them into the meta data object that is typically the final
    //parameter.
    var loggerFacade = {
        winstonLogger: theLogger,

        preprocess: function (argArray) {

            if (!argArray || argArray.length === 0) {
                this.winstonLogger.warn('logging without any args');
                return argArray;
            }

            //Account and realm should be included for most logging statements
            //but some are not related to any particular request so we set
            //some default values.  These will be overridden by any incoming
            //values.
            var allObjs = {
                account: 'voyent', realm: 'service.general'
            };

            //Loop through each argument to see if it's an object and,
            //if it is, merge it with our single meta object.
            ld.each(argArray, function (arg) {

                if (ld.isObject(arg)) {
                    ld.assign(allObjs, arg);
                }
            });

            //If there is a property in any of the objects called
            //_skipPreProcess and it's set to true, then bail out.
            if (allObjs._skipPreProcess === true) {
                return argArray;
            }

            //Lastly, we need to either replace the existing meta object (if
            //the last arg was an object), or add an object to the end.  This
            //final object will be the thing that gets parsed as part of the
            //logging aggregator before the log gets stored (in MongoDB or
            //ElasticSearch or whatever).
            if (ld.isObject(ld.last(argArray))) {
                argArray[argArray.length - 1] = allObjs;
            } else {
                argArray.push(allObjs);
            }

            return argArray;
        },

        error: function () {
            var processedArgs = this.preprocess(Array.from(arguments));
            this.winstonLogger.error.apply(this, processedArgs);
        },

        warn: function () {
            var processedArgs = this.preprocess(Array.from(arguments));
            this.winstonLogger.warn.apply(this, processedArgs);
        },

        info: function () {
            var processedArgs = this.preprocess(Array.from(arguments));
            this.winstonLogger.info.apply(this, processedArgs);
        },

        debug: function () {
            var processedArgs = this.preprocess(Array.from(arguments));
            this.winstonLogger.debug.apply(this, processedArgs);
        },
    };

    return loggerFacade;

}