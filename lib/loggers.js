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
var util = require('util');
var CustomLogger = require('./customLogger').CustomLogger;

module.exports.getLogger = function getLogger(userOptions) {

    var settings = config.logging.defaults;
    if (userOptions) {
        settings = us.extend(config.logging.defaults, userOptions);
    }
    if (!winston.loggers.has(settings.logName)) {

        var consoleConfig = {
            level: settings.logLevel,
            silent: false,
            colorize: true,
            timestamp: true
        };

        var fileConfig = {
            level: settings.logLevel,
            silent: false,
            colorize: false,
            timestamp: true,
            filename: settings.logFile,
            maxsize: 256000,
            maxFiles: 5,
            json: false
        };
        // For now, The mongo storage location is defined by the config options that define the location
        // of the mongo database in db.js.
        var mongoConfig = {
            name: 'custom',
            level: 'info',
            collection: config.auditLoggerSettings.collection,
            fixedRealm: 'audit', // This is kept in a fixed 'audit' realm
            capSize: config.auditLoggerSettings.capSize
        };

        var debugConfig = {
            name: 'debugTransport',
            level: 'debug',
            collection: config.debugLoggerSettings.collection,
            capSize: config.debugLoggerSettings.capSize
            // without fixedRealm, the debug logger gets put in the realm
        };

        winston.loggers.options.transports = [
            // Setup your shared transports here
            new (winston.transports.Console)(consoleConfig),
            new (winston.transports.File)( fileConfig ),
            new (CustomLogger)(mongoConfig)
        ];
        // If the trace logger is not void, set it up
        if (config.debugLoggerSettings.collection !== 'void') {
            winston.loggers.options.transports.push( new (CustomLogger)(debugConfig));
        }

        //Only add the logger instance if we don't already have one by that name
        winston.loggers.add(settings.logName, {});
    }

    var theLogger = winston.loggers.get(settings.logName);
    //This is added to allow existing calls that use logger.stack() to run properly. Once
    //nobody is using it any longer, we can remove this little hack.
    theLogger.stack = function () {
        return '[n/a]';
    };
    return theLogger;
};
