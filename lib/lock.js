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

var db = require('./db');

/**
 * We don't need a "real" error for indicating that a resource is locked.  We
 * just need to throw something that looks like an error that we can easily
 * identify and act on.
 *
 * @param message
 * @constructor
 */
function LockError(message) {
    this.name = 'LockError';
    this.message = message;
}


function checkParameters(params) {

    var paramErrs = [];

    if (!params) {
        paramErrs.push('missing params');
    }

    if (!params.accountId) {
        paramErrs.push('missing params.accountId');
    }

    if (!params.realmId) {
        paramErrs.push('missing params.realmId');
    }

    //They key to use for the lock.  Defaults to the resourceId if available and
    //not otherwise specified.
    if (!params.lockId) {

        if (params.validatedResourceId) {
            params.lockId = params.validatedResourceId;
        } else {
            paramErrs.push('missing params.lockId');
        }
    }

    //The owner of the lock if provided.  Mostly helpful for debugging so
    //optional.  Defaults to the tx id if not otherwise specified.
    if (!params.owner) {
        if (params.meta && params.meta.tx) {
            params.owner = params.meta.tx;
        } else {
            params.owner = 'unknown';
        }
    }

    return paramErrs;
}

/**
 * Used to "lock" a resource so that multiple requests don't access it at the
 * same time.  Generally for preventing multiple REST API calls modifying the
 * same document concurrently.
 *
 * Since the lock is stored in the database, the account and realm are required
 * so that the lock is inserted/deleted from the appropriate collection.
 *
 * The lockId is basically any string you want to use as a key.  The initial idea
 * was that the id of the resource would be the most logical choice so that it
 * is relevant across multiple service instances, etc. but other values might
 * make sense depending on the situation.  If a lockId is not specified, it will
 * automatically try to use a validatedResourceId if one if present.
 *
 * The owner is the owner of the lock. It is optional but can be helpful for
 * debugging.
 *
 * The params include the account and realm.  When the work function is done,
 * the provided callback must be called so that the lock can be released and
 * the final lockCallback can be executed.
 *
 * If the lock is already held, a LockError object is provided back as the
 * error.  The general approach for our APIs is that we check for the LockError
 * and respond with an HTTP status code of 423 LOCKED.
 *
 * @param params
 * @param params.accountId
 * @param params.realmId
 * @param params.lockId
 * @param params.owner (optional)
 * @param lockCallback
 */
function lock(params, lockCallback) {

    //Ensure we have all the requisite parameters.
    var paramErrs = checkParameters(params);

    var logger = require('./loggers').getLogger();

    if (paramErrs && paramErrs.length > 0) {
        logger.error(paramErrs.join(', '));
        lockCallback(new Error(paramErrs.join(', ')), params);
        return;
    }

    logger.debug('lock parameters',
        '\n  account:', params.accountId,
        '\n  realm  :', params.realmId,
        '\n  owner  :', params.owner,
        '\n  lock id:', params.lockId
    );

    //Get the collection for the locks.
    db.getCollection(process.env.SERVICE_NAME,'locks', function (err, coll) {

        if (err) {
            logger.error('db collection error', params.accountId, params.realmId, params.lockId, err);
            lockCallback(new Error('db collection error'), params);
            return;
        }


        //The locking strategy is that, if a record already exists for the
        //key, then it is locked.
        var lockRecord = {
            _id: params.lockId,
            owner: params.owner,
            _account: params.accountId,
            _realm: params.realmId
        };

        coll.insertOne(lockRecord, function (err, result) {

            if (err) {

                //The MongodDB error code for inserting a duplicate key is
                //11000.  We interpret this to be that the resource associated
                //with this key is "locked". The failure handling for a locked resource
                //is still a bit up in the air.  Right now we'll likely return
                //a status code like 409 CONFLICT or 423 LOCKED.
                if (err.code && err.code === 11000) {
                    logger.warn(
                        'lock acquired false',
                        params.accountId,
                        params.realmId,
                        params.lockId,
                        params.owner
                    );
                    lockCallback(new LockError('failed to acquire lock'), params);
                    return;
                }

                logger.error('lock db insert error', params.accountId, params.realmId, params.lockId, err);
                lockCallback(new Error('lock db insert error'), params);
                return;
            }

            var lockAcquiredTime = Date.now();
            logger.debug(
                'lock acquired true',
                params.accountId,
                params.realmId,
                params.lockId,
                params.owner
            );

            //Closure function for releasing the lock. This needs to be called
            //whenever the work that uses the lock is done, whether it runs
            //to completion, throws an error, etc.
            params.releaseLock = function (lockReleaseCallback) {

                var key = params.lockId;
                var lockCollection = coll;

                //To release the lock, we delete it from the database.
                lockCollection.deleteOne({_id: key}, function (err, result) {

                    if (err) {
                        logger.debug('lock db delete error', lockCollection.collectionName, key, err.message);
                        lockReleaseCallback(new Error('lock db delete error'));
                        return;
                    }

                    logger.debug(
                        'lock released',
                        Date.now() - lockAcquiredTime + ' ms',
                        params.accountId,
                        params.realmId,
                        params.lockId,
                        params.owner
                    );

                    lockReleaseCallback();

                });
            };

            lockCallback(null, params);

        });

    });

}
module.exports.lock = lock;