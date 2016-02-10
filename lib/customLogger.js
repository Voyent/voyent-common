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
    // If this is the debug logger, then skip warn and error
    if (this.level == 'silly' && level != this.level) {
        return callback(null, true);
    }
    // For the audit logger, always log the warn and error levels, otherwise skip
    if (level !== this.level && level !== 'error' && level != 'warn' ) {
        return callback (null, true);
    }
    var record = {};

    if (meta.realmName) record.realmName = meta.realmName;
    if (meta.tx) record.tx = meta.tx;
    //if (meta.access_token) record.access_token = meta.access_token;
    if (meta.username) record.username = meta.username;
    if (meta.service) {
        record.service = meta.service;
    } else {
        record.service = 'unknown';
    }
    record.message = msg;
    record.level = level;
    record.time = new Date();

    var loggingRealm = meta.realmName;
    if (this.fixedRealm) {
        loggingRealm = this.fixedRealm;
    }
    var safedb = db.getSafeDatabaseName(meta.accountName);
    db.getCappedCollection(safedb, loggingRealm, this.collection, this.capSize, function(err, collection) {
        if (err) {
            return callback(err, false);
        }
        collection.insert( record, function(err, result) {
            if (err) {
                return callback(err, false);
            }
            return callback(err, true);
        });
    });
};

module.exports.CustomLogger = CustomLogger;