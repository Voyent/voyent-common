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


//
var CustomLogger = winston.transports.CustomerLogger = function (options) {
    //
    // Name this logger
    //
    this.name = options.name || 'customLogger';

    //
    // Set the level from your options
    //
    this.level = options.level || 'debug';

    //
    // Configure your storage backing as you see fit
    //
};

//
// Inherit from `winston.Transport` so you can take advantage
// of the base functionality and `.handleExceptions()`.
//
util.inherits(CustomLogger, winston.Transport);

CustomLogger.prototype.log = function (level, msg, meta, callback) {

    // This would be a log message without a meta object. For now, let the other
    // transports handle this. This allows anonymous logging statements to just show up
    // in the console without creating extra realms for it.
    if (!meta) {
        return callback(null, true);
    }
    var record = {};
    if (meta.accountName) {
        record.accountName = db.getSafeDatabaseName(meta.accountName);
    }
    if (meta.realmName) record.realmName = meta.realmName;
    if (meta.tx) record.tx = meta.tx;
    if (meta.access_token) record.access_token = meta.access_token;
    if (meta.username) record.username = meta.username;
    record.message = msg;
    record.level = level;
    record.time = new Date();

    // Temporary hack until we find out where to put this.
    if (!record.accountName) {
        record.accountName = 'bridgeit';
    }

    var safedb = db.getSafeDatabaseName(record.accountName);
    db.getCollection(safedb, 'audit', 'audit', function(err, collection) {
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