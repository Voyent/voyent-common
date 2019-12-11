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
"use strict";
var util = require('util');
var db = require('./db');
var winston = require('winston');
var config = require('./config');



//
var CustomLogger = winston.transports.CustomerLogger = function (options) {
    //
    // Name this logger
    //
    this.name = options.name || 'customLogger';

    //
    // Set the level from your options
    //
    //console.log('setting mongo logger to level: ' + options.level);
    this.level = options.level || 'info';

    //
    // Allow a configurable collection name
    //
    this.collection = options.collection || 'audit';

    //
    this.fixedRealm = options.fixedRealm;

    // Allow configurable logger capsize
    this.capSize = options.capSize || 10000;
};

//
// Inherit from `winston.Transport` so you can take advantage
// of the base functionality and `.handleExceptions()`.
//
util.inherits(CustomLogger, winston.Transport);

CustomLogger.prototype.log = function (level, msg, meta, callback) {

    // This would be a log message without a meta object and an accountName. For now, let the other
    // transports handle this.
    if (!meta || !meta.accountName) {
        return callback(null, true);
    }
    // For the default winston log levels, silly = 0, error = 5 so if the message level is less
    // than the configured level, skip it. Note that the RFC syslog levels are defined in the opposite
    // ordinal order so if we go to a different set of levels, we'll want to adjust this logic
    var npmLevel = winston.config.npm.levels[level];
    var logLevel = winston.config.npm.levels[this.level];
    if (npmLevel < logLevel) {
        return callback (null, true);
    }
    //console.log('name: ' + this.name + ', account: ' + meta.accountName + ', ' + meta.realmName + ', level: ' + level + ', this.level: ' + this.level);
    var record = {};

    if (meta.realmName) record.realmName = meta.realmName;
    if (meta.tx) record.tx = meta.tx;
    if (meta.username) record.username = meta.username;
    if (meta.service) {
        record.service = meta.service;
    } else {
        record.service = 'unknown';
    }
    record.message = msg;
    record.level = level;
    record.time = new Date();

    // If the fixed realm is defined, we log into that, but we don't want to use
    // that as the realm for the message
    var loggingRealm = meta.realmName;
    if (this.fixedRealm) {
        loggingRealm = this.fixedRealm;
    }

    // What to do here? Cant insert this into an 'undefined' collection, yet I can't log it effectively
    // to the console either and have it be seen.
    if (!loggingRealm) {
        record.level = 'error';
        loggingRealm = 'audit';
        record.message += ' [the source of this log message has not included a realm in meta]';
    } else {
        loggingRealm = loggingRealm.toLowerCase();
    }
    var safedb = db.getSafeDatabaseName(meta.accountName);
    record._account = safedb;
    record._realm = loggingRealm;
    db.getCollection(process.env.SERVICE_NAME, this.collection, function(err, collection) {
        if (err) {
            return callback(err, false);
        }
        collection.insertOne( record, function(err, result) {
            if (err) {
                return callback(err, false);
            }
            return callback(err, true);
        });
    });
};

module.exports.CustomLogger = CustomLogger;

