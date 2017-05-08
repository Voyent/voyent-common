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
var tools = require('./tools');

var TRANSACTION_HEADER_KEY = 'com.icesoft.services.transaction.id';
module.exports.TRANSACTION_HEADER_KEY = TRANSACTION_HEADER_KEY;

var PROCESS_HEADER_KEY = 'com.icesoft.services.process.id';
module.exports.PROCESS_HEADER_KEY = PROCESS_HEADER_KEY;

//For the purposes of the service scope, a "request" and a "transaction" are the same.  Each 
//request to our services is assigned a transactionId that travels through all relevant services
//and is the id which is used to store any request/transaction scoped data.
// var ICESOFT_REQUEST_HEADER = "com.icesoft.services.request.id";


//Any scopes that that require cleanup via Mongo's TTL policy should have the field
//declared as part of this array.  That way we can validate the fields before setting
//them as part of the various operations.  This also requires a particular index be
//created on the scopes collection, one for each scope.
//
//   db.myRealm.scopes.createIndex( { "_transactionLastModified": 1 }, { expireAfterSeconds: 60 } )
//   db.myRealm.scopes.createIndex( { "_sessionLastModified": 1 }, { expireAfterSeconds: 3600 } )

var TRANSACTION_LAST_ACCESSED = '_transactionLastModified';
module.exports.TRANSACTION_LAST_ACCESSED = TRANSACTION_LAST_ACCESSED;

var SESSION_LAST_ACCESSED = '_sessionLastModified';
module.exports.SESSION_LAST_ACCESSED = SESSION_LAST_ACCESSED;

var LAST_ACCESSED_FIELDS = [TRANSACTION_LAST_ACCESSED, SESSION_LAST_ACCESSED];


/**
 * Get a specific scope API as defined by the provided scopeIdentifier. The result is
 * a Promise that resolves to a standard API for that particular scope.
 *
 * This is not generally meant for public consumption. Instead, clients should use the
 * concrete methods for the particular scope (getRequestScope, getBackpackScope, etc. ).
 * However, it is possible to use this for managing custom scopes if we want to provide
 * that feature.
 *
 * @param accountName
 * @param realmName
 * @param scopeIdentifier The id of the scope object to create
 * @param accessedField   Optional parameter that describes the name of the field to store and index
 *                        the time that a scope was last accessed. This is useful for helping to
 *                        determine when time-sensitive scopes should be cleaned up.
 *
 * @returns {Promise}
 */
function getScope(accountName, realmName, scopeIdentifier, accessedField) {

    return new Promise(function (resolve, reject) {

        //Must have a valid account
        if (!accountName) {
            reject('cannot get scope without account');
        }

        //Must have a valid realm
        if (!realmName) {
            reject('cannot get scope without realm');
        }

        //Must have a valid scopeId
        if (!scopeIdentifier) {
            reject('cannot get scope without scope identifier');
        }

        var scopeId = scopeIdentifier;

        //The lastModifiedField is optional - only necessary if the scope is time-sensitive
        //in some way.
        var lastAccessedField = accessedField;

        if (lastAccessedField && LAST_ACCESSED_FIELDS.indexOf(lastAccessedField) < 0) {
            reject('unknown lastAccessedField: ' + lastAccessedField);
        }
        db.getCollection(accountName, realmName, 'scopes', function (err, scopesCollection) {

            if (err) {
                var logger = require('./loggers').getLogger();
                logger.error('Failed to get scopes collection: ' + accountName + ', realm: ' + realmName +
                ', scopes', err);
                reject(err);
            }

            //This object contains the general API for any scope.  The collection is always
            //the same, the only difference between them is which scopeId is used as the
            //database _id and that's provided when you initially get the scope.
            var scopeAPI = {

                setAttribute: function (key, value) {

                    return new Promise(function (resolve, reject) {

                        var updateAttribute = {};
                        updateAttribute[key] = value;

                        if (lastAccessedField) {
                            updateAttribute[lastAccessedField] = new Date();
                        }

                        scopesCollection
                            .updateOne(
                                {_scopeId: scopeId},
                                {$set: updateAttribute},
                                {upsert: true})
                            .then(
                                function (result) {

                                    if (result.result && result.result.ok === 1) {
                                        var setResult = {};
                                        setResult[key] = value;
                                        resolve(setResult);
                                    } else {
                                        reject(result.result);
                                    }
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });

                },

                setAttributes: function (obj) {

                    return new Promise(function (resolve, reject) {

                        var updateAttribute = obj;

                        if (lastAccessedField) {
                            updateAttribute[lastAccessedField] = new Date();
                        }

                        scopesCollection
                            .updateOne(
                                {_scopeId: scopeId},
                                {$set: updateAttribute},
                                {upsert: true})
                            .then(
                                function (result) {
                                    if (result.result && result.result.ok === 1) {
                                        resolve(obj);
                                    } else {
                                        reject(result.result);
                                    }
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });

                },

                getAttribute: function (key) {

                    //If the lastModifiedField parameter is set to a known/legal value, we return
                    //a Promise that also updates the lastModifiedField.  If not, we return a
                    //a Promise that just returns the value.

                    if (lastAccessedField) {

                        return new Promise(function (resolve, reject) {

                            var lastModified = {};
                            lastModified[lastAccessedField] = new Date();

                            scopesCollection
                                .findOneAndUpdate({_scopeId: scopeId}, {$set: lastModified})
                                .then(
                                    function (result) {
                                        if (result.value) {
                                            if (key.indexOf('.') == -1) {
                                                result.value[key] ? resolve(result.value[key]) : resolve();
                                            }
                                            else {
                                                var val = key.split('.').reduce(function(obj,i) {
                                                    if (obj && obj[i]) { return obj[i]; }
                                                },result.value);
                                                val ? resolve(val) : resolve();
                                            }
                                        }
                                        else {
                                            resolve();
                                        }
                                    }
                                )
                                .catch(
                                    function (err) {
                                        reject(err);
                                    }
                                );
                        });
                    }

                    return new Promise(function (resolve, reject) {

                        scopesCollection
                            .find({_scopeId: scopeId})
                            .limit(1)
                            .toArray()
                            .then(
                                function (result) {
                                    if (result[0]) {
                                        if (key.indexOf('.') == -1) {
                                            result[0][key] ? resolve(result[0][key]) : resolve();
                                        }
                                        else {
                                            var val = key.split('.').reduce(function(obj,i) {
                                                if (obj && obj[i]) { return obj[i]; }
                                            },result[0]);
                                            val ? resolve(val) : resolve();
                                        }
                                    }
                                    else {
                                        resolve();
                                    }
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });
                },

                getAttributes: function () {

                    //If the lastModifiedField parameter is set to a known/legal value, we return
                    //a Promise that also updates the lastModifiedField.  If not, we return a
                    //a Promise that just returns the value.

                    //We only want to return the scoped values so turn off the others.
                    var projection = {_id: 0, _scopeId: 0};

                    //TODO: Block any meta fields related to tracking last modified time.
                    projection[TRANSACTION_LAST_ACCESSED] = 0;
                    projection[SESSION_LAST_ACCESSED] = 0;

                    if (lastAccessedField) {

                        return new Promise(function (resolve, reject) {

                            var lastModified = {};
                            lastModified[lastAccessedField] = new Date();

                            scopesCollection
                                .findOneAndUpdate({_scopeId: scopeId}, {$set: lastModified})
                                .project(projection)
                                .then(
                                    function (result) {
                                        if (result.value) {
                                            resolve(result.value);
                                        } else {
                                            resolve(result);
                                        }
                                    }
                                )
                                .catch(
                                    function (err) {
                                        reject(err);
                                    }
                                );
                        });
                    }

                    return new Promise(function (resolve, reject) {

                        scopesCollection
                            .find({_scopeId: scopeId})
                            .limit(1)
                            .project(projection)
                            .toArray()
                            .then(
                                function (result) {
                                    if (result[0]) {
                                        resolve(result[0]);
                                    } else {
                                        resolve();
                                    }
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });
                },

                removeAttribute: function (key) {

                    return new Promise(function (resolve, reject) {

                        var removeAttribute = {};
                        removeAttribute[key] = "";

                        if (lastAccessedField) {
                            removeAttribute[lastAccessedField] = new Date();
                        }

                        scopesCollection
                            .updateOne(
                                {_scopeId: scopeId},
                                {$unset: removeAttribute})
                            .then(
                                function (result) {

                                    if (result.result && result.result.ok === 1) {
                                        resolve(key);
                                    } else {
                                        reject(result.result);
                                    }
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });
                },

                getAttributeKeys: function () {

                    return new Promise(function (resolve, reject) {

                        //We only want to return the scoped values so turn off the others.
                        var projection = {_id: 0, _scopeId: 0};

                        //TODO: Block any meta fields related to tracking last modified time.
                        projection[TRANSACTION_LAST_ACCESSED] = 0;
                        projection[SESSION_LAST_ACCESSED] = 0;

                        scopesCollection
                            .find({_scopeId: scopeId})
                            .project(projection)
                            .toArray()
                            .then(
                                function (result) {
                                    resolve(Object.keys(result[0]));
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });

                },

                getId: function () {
                    return scopeId;
                },

                touch: function () {
                    return new Promise(function (resolve, reject) {

                        if (!lastAccessedField) {
                            return Promise.resolve();
                        }

                        var updateAttribute = {};
                        updateAttribute[lastAccessedField] = new Date();

                        scopesCollection
                            .updateOne(
                                {_scopeId: scopeId},
                                {$set: updateAttribute},
                                {upsert: false})
                            .then(
                                function (result) {
                                    if (result.result && result.result.ok === 1) {
                                        resolve(updateAttribute);
                                    } else {
                                        reject(result.result);
                                    }
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });
                },

                invalidate: function () {
                    return new Promise(function (resolve, reject) {
                        scopesCollection
                            .remove({_scopeId: scopeId})
                            .then(
                                function (result) {
                                    if (result.result && result.result.ok === 1) {
                                        resolve(scopeId);
                                    } else {
                                        reject(result.result);
                                    }
                                }
                            )
                            .catch(
                                function (err) {
                                    reject(err);
                                }
                            );
                    });
                },

                //The following have not been implemented yet.  They reflect what we know
                //of standard JavaEE session APIs but may or may not be applicable for our
                //purposes.
                getCreationTime: function () {
                    //TODO
                    return new Promise(function (resolve, reject) {
                        resolve();
                    });
                },

                getLastAccessedTime: function () {
                    //TODO
                    return new Promise(function (resolve, reject) {
                        resolve();
                    });
                },

                getMaxInactiveInterval: function () {
                    //TODO
                    return new Promise(function (resolve, reject) {
                        resolve();
                    });
                },

                setMaxInactiveInterval: function (interval) {
                    //TODO
                    return new Promise(function (resolve, reject) {
                        resolve();
                    });
                }

            };

            resolve(scopeAPI);
        });

    });

}
module.exports.getScope = getScope;


// -------------------------
// BASE SCOPE FUNCTIONS
// -------------------------

//The following functions are the base calls used by all scope-related
//functions. They simply use the provided scopeId to operate since all
//scopes use their own id to store the specific data.

function getScopeFromBarrel(barrel, scopeId, accessedField) {
    return getScope(barrel.accountId, barrel.realmId, scopeId, accessedField);
}


/**
 * Set a single key-value pair in the scope map
 * @param barrel barrel containing the accountId and realmId properties
 * @param scopeId
 * @param key the property key to set
 * @param value the property value
 * @param accessedField
 * @returns {Promise}
 */
function setAttribute(barrel, scopeId, key, value, accessedField) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId, accessedField)
            .then(
                function (scope) {

                    scope.setAttribute(key, value)
                        .then(
                            function (setResult) {
                                resolve(setResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}
/**
 * Set all the property names-> values contained in an object in the scope map.
 */
function setAttributes(barrel, scopeId, obj, accessedField) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId, accessedField)
            .then(
                function (scope) {

                    scope.setAttributes(obj)
                        .then(
                            function (setResult) {
                                resolve(setResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}

function getAttribute(barrel, scopeId, key, accessedField) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId, accessedField)
            .then(
                function (scope) {

                    scope.getAttribute(key)
                        .then(
                            function (getResult) {
                                resolve(getResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}

function getAttributes(barrel, scopeId, accessedField) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId, accessedField)
            .then(
                function (scope) {

                    scope.getAttributes()
                        .then(
                            function (getResult) {
                                resolve(getResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}

function removeAttribute(barrel, scopeId, key, accessedField) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId, accessedField)
            .then(
                function (scope) {

                    scope.removeAttribute(key)
                        .then(
                            function (removeResult) {
                                resolve(removeResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}


function getAttributeKeys(barrel, scopeId) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId)
            .then(
                function (scope) {

                    scope.getAttributeKeys()
                        .then(
                            function (keysResult) {
                                resolve(keysResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}

function touch(barrel, scopeId, accessedField) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId, accessedField)
            .then(
                function (scope) {

                    scope.touch()
                        .then(
                            function (setResult) {
                                resolve(setResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}

function invalidate(barrel, scopeId) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId)
            .then(
                function (scope) {

                    scope.invalidate()
                        .then(
                            function (invalidateResult) {
                                resolve(invalidateResult);
                            }
                        )
                        .catch(
                            function (err) {
                                reject(err);
                            }
                        );
                })
            .catch(
                function (err) {
                    reject(err);
                }
            );
    });
}


/**
 * Extracts the raw request from the barrel and uses that to get
 * the value of the specified header.
 *
 * @param barrel
 * @param headerName
 * @returns {*}
 */
function getHeader(barrel, headerName) {
    //TODO: make sure this is correct and robust
    if (barrel && barrel.req) {
        return barrel.req.headers[headerName];
    }
}


/**
 * Get a listing of all the scopes in the given account and realm.
 *
 * @param accountName The account name
 * @param realmName The realm
 * @returns {Promise}
 */
function getAllScopes(accountName, realmName) {

    return new Promise(function (resolve, reject) {

        db.getCollection(accountName, realmName, 'scopes', function (err, scopesCollection) {

            if (err) {
                reject(err);
            }
            scopesCollection.find().toArray(function (err, scopes) {
                if (err) {
                    console.log('err! ', err);
                    reject(err);
                }
                resolve(scopes);
            });
        });
    });
}
module.exports.getScopesDirectory = getAllScopes;


// -------------------------
// TRANSACTION SCOPE
// -------------------------

/**
 * Get the transaction id header from the request object stored in the barrel.
 *
 * @param barrel
 * @returns {*}
 */
function getTransactionId(barrel) {
    //First try the header as that's where it typically is for HTTP requests.
    var transactionId = getHeader(barrel, TRANSACTION_HEADER_KEY);

    //If not there, it could be just set on the barrel.
    if (!transactionId) {
        transactionId = barrel.transactionId;
    }

    return transactionId;
}
module.exports.getTransactionId = getTransactionId;

/**
 * Set a transaction-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setTransactionAttribute(barrel, key, value) {
    return setAttribute(barrel, getTransactionId(barrel), key, value, TRANSACTION_LAST_ACCESSED);
}
module.exports.setTransactionAttribute = setTransactionAttribute;

/**
 * Set a transaction-scoped key/value pair.
 *
 * @param barrel
 * @param obj
 * @returns {Promise|Promise<T>}
 */
function setTransactionAttributes(barrel, obj) {
    return setAttributes(barrel, getTransactionId(barrel), obj);
}
module.exports.setTransactionAttributes = setTransactionAttributes;

/**
 * Get the value of a transaction-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getTransactionAttribute(barrel, key) {
    return getAttribute(barrel, getTransactionId(barrel), key, TRANSACTION_LAST_ACCESSED);
}
module.exports.getTransactionAttribute = getTransactionAttribute;

/**
 * Get all the current attributes in the specified transaction scope.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getTransactionAttributes(barrel) {
    return getAttributes(barrel, getTransactionId(barrel));
}
module.exports.getTransactionAttributes = getTransactionAttributes;

/**
 * Remove a transaction-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeTransactionAttribute(barrel, key) {
    return removeAttribute(barrel, getTransactionId(barrel), key, TRANSACTION_LAST_ACCESSED);
}
module.exports.removeTransactionAttribute = removeTransactionAttribute;

/**
 * Get all the current transaction-scoped keys.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getTransactionAttributeKeys(barrel) {
    return getAttributeKeys(barrel, getTransactionId(barrel));
}
module.exports.getTransactionAttributeKeys = getTransactionAttributeKeys;


/**
 * Update the last accessed time for this scope.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function touchTransaction(barrel) {
    return touch(barrel, getTransactionId(barrel), TRANSACTION_LAST_ACCESSED);
}
module.exports.touchTransaction = touchTransaction;

/**
 * Invalidate the current transaction scoped storage.  This should
 * generally be used for cleaning up the entire scope when it's no longer
 * valid.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function invalidateTransaction(barrel) {
    return invalidate(barrel, getTransactionId(barrel));
}
module.exports.invalidateTransaction = invalidateTransaction;


// -------------------------
// REALM SCOPE
// -------------------------

/**
 * Get the realm id header from the request object stored in the barrel.
 *
 * @param barrel
 * @returns {*}
 */
function getRealmId(barrel) {
    return "_realm_" + barrel.realmId;
}


/**
 * Set a realm-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setRealmAttribute(barrel, key, value) {
    return setAttribute(barrel, getRealmId(barrel), key, value);
}
module.exports.setRealmAttribute = setRealmAttribute;

/**
 * Set a realm-scoped key/value pair.
 *
 * @param barrel
 * @param obj
 * @returns {Promise|Promise<T>}
 */
function setRealmAttributes(barrel, obj) {
    return setAttributes(barrel, getRealmId(barrel), obj);
}
module.exports.setRealmAttributes = setRealmAttributes;

/**
 * Get the value of a realm-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getRealmAttribute(barrel, key) {
    return getAttribute(barrel, getRealmId(barrel), key);
}
module.exports.getRealmAttribute = getRealmAttribute;

/**
 * Get all the current attributes in the specified realm scope.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getRealmAttributes(barrel) {
    return getAttributes(barrel, getRealmId(barrel));
}
module.exports.getRealmAttributes = getRealmAttributes;

/**
 * Remove a realm-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeRealmAttribute(barrel, key) {
    return removeAttribute(barrel, getRealmId(barrel), key);
}
module.exports.removeRealmAttribute = removeRealmAttribute;

/**
 * Get all the current realm-scoped keys.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getRealmAttributeKeys(barrel) {
    return getAttributeKeys(barrel, getRealmId(barrel));
}
module.exports.getRealmAttributeKeys = getRealmAttributeKeys;

/**
 * Invalidate the current realm-scoped storage.  This should
 * generally be used for cleaning up the entire scope when it's no longer
 * valid.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function invalidateRealm(barrel) {
    return invalidate(barrel, getRealmId(barrel));
}
module.exports.invalidateRealm = invalidateRealm;


// -------------------------
// ACTION SCOPE
// -------------------------

/**
 * Get the currently executing action id from the barrel.
 *
 * @param barrel
 * @returns The current action id (if there is one).
 */
function getActionId(barrel) {

    //TODO: What uniquely identifies the currently running action?
    //      We just need to check and retrieve that information from the
    //      barrel.  For example, if we are in the Action service and
    //      executing an action, the validatedResourceId coupled with something
    //      like the tx id - together that would uniquely identify the scope.
    if (
        barrel.meta && barrel.meta.service && barrel.meta.service === 'action' &&
        barrel.serviceEvent && barrel.serviceEvent === 'execute'
    ) {
        return barrel.validatedResourceId;
    }
    return null;
}

/**
 * Set a action-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setActionAttribute(barrel, key, value) {
    return setAttribute(barrel, getActionId(barrel), key, value);
}
module.exports.setActionAttribute = setActionAttribute;


/**
 * Get the value of a action-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getActionAttribute(barrel, key) {
    return getAttribute(barrel, getActionId(barrel), key);
}
module.exports.getActionAttribute = getActionAttribute;


/**
 * Remove a action-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeActionAttribute(barrel, key) {
    return removeAttribute(barrel, getActionId(barrel), key);
}
module.exports.removeActionAttribute = removeActionAttribute;

/**
 * Get all the current action-scoped keys.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getActionAttributeKeys(barrel) {
    return getAttributeKeys(barrel, getActionId(barrel));
}
module.exports.getActionAttributeKeys = getActionAttributeKeys;

/**
 * Invalidate the current action-scoped storage.  This should
 * generally be used for cleaning up the entire scope when it's no longer
 * valid.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function invalidateAction(barrel) {
    return invalidate(barrel, getActionId(barrel));
}
module.exports.invalidateAction = invalidateAction;


// -------------------------
// PROCESS SCOPE
// -------------------------

/**
 * Get the currently executing process id from the barrel.
 *
 * @param barrel
 * @returns The current action id (if there is one).
 */
function getProcessId(barrel) {

    //First try the header as that's where it typically is for HTTP requests.
    var processId = getHeader(barrel, PROCESS_HEADER_KEY);

    //If not there, it may be in the body of an event.
    if (!processId) {
        var bodyAsJSON = tools.getBodyAsJSON(barrel.req);
        if (bodyAsJSON && bodyAsJSON.processId) {
            processId = bodyAsJSON.processId;
        }
    }

    //If not there, it could be just set on the barrel.
    if (!processId) {
        processId = barrel.processId;
    }

    return processId;
}
module.exports.getProcessId = getProcessId;

/**
 * Set a process-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setProcessAttribute(barrel, key, value) {
    return setAttribute(barrel, getProcessId(barrel), key, value);
}
module.exports.setProcessAttribute = setProcessAttribute;

/**
 * Set a process-scoped key/value pair.
 *
 * @param barrel
 * @param obj
 * @returns {Promise|Promise<T>}
 */
function setProcessAttributes(barrel, obj) {
    return setAttributes(barrel, getProcessId(barrel), obj);
}
module.exports.setProcessAttributes = setProcessAttributes;

/**
 * Get the value of a process-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getProcessAttribute(barrel, key) {
    return getAttribute(barrel, getProcessId(barrel), key);
}
module.exports.getProcessAttribute = getProcessAttribute;

/**
 * Get all the current attributes in the specified process scope.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getProcessAttributes(barrel) {
    return getAttributes(barrel, getProcessId(barrel));
}
module.exports.getProcessAttributes = getProcessAttributes;

/**
 * Remove a process-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeProcessAttribute(barrel, key) {
    return removeAttribute(barrel, getProcessId(barrel), key);
}
module.exports.removeProcessAttribute = removeProcessAttribute;

/**
 * Get all the current process-scoped keys.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getProcessAttributeKeys(barrel) {
    return getAttributeKeys(barrel, getProcessId(barrel));
}
module.exports.getProcessAttributeKeys = getProcessAttributeKeys;

/**
 * Invalidate the current process-scoped storage.  This should
 * generally be used for cleaning up the entire scope when it's no longer
 * valid.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function invalidateProcess(barrel) {
    return invalidate(barrel, getProcessId(barrel));
}
module.exports.invalidateProcess = invalidateProcess;

// -------------------------
// USER SCOPE
// -------------------------

/**
 * Get the username from the barrel.
 *
 * @param barrel
 * @returns The current user id (if there is one).
 */
function getUserId(barrel) {
    return barrel.username || null;
}
module.exports.getUserId = getUserId;

/**
 * Set a user-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setUserAttribute(barrel, key, value) {
    return setAttribute(barrel, getUserId(barrel), key, value);
}
module.exports.setUserAttribute = setUserAttribute;

/**
 * Set a user-scoped key/value pair.
 *
 * @param barrel
 * @param obj
 * @returns {Promise|Promise<T>}
 */
function setUserAttributes(barrel, obj) {
    return setAttributes(barrel, getUserId(barrel), obj);
}
module.exports.setUserAttributes = setUserAttributes;

/**
 * Get the value of a user-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getUserAttribute(barrel, key) {
    return getAttribute(barrel, getUserId(barrel), key);
}
module.exports.getUserAttribute = getUserAttribute;

/**
 * Get all the current attributes in the specified user scope.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getUserAttributes(barrel) {
    return getAttributes(barrel, getUserId(barrel));
}
module.exports.getUserAttributes = getUserAttributes;

/**
 * Remove a user-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeUserAttribute(barrel, key) {
    return removeAttribute(barrel, getUserId(barrel), key);
}
module.exports.removeUserAttribute = removeUserAttribute;

/**
 * Get all the current user-scoped keys.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getUserAttributeKeys(barrel) {
    return getAttributeKeys(barrel, getUserId(barrel));
}
module.exports.getUserAttributeKeys = getUserAttributeKeys;

/**
 * Invalidate the current user-scoped storage.  This should
 * generally be used for cleaning up the entire scope when it's no longer
 * valid.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function invalidateUser(barrel) {
    return invalidate(barrel, getUserId(barrel));
}
module.exports.invalidateUser = invalidateUser;

// -----------------
// ENVIRONMENT SCOPE
// -----------------
/**
 * This represents a top level voyent level scope for storing configuration information
 * on an installation wide basis
 */

/**
 * Get the environment Id. It is constant given the global worldwide nature of the scope
 *
 * @param barrel
 * @returns {*}
 */
function getEnvironmentId(barrel) {
    return "_environment_";
}

/**
 * Set a environment-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setEnvironmentAttribute(barrel, key, value) {
    return setAttribute(barrel, getEnvironmentId(barrel), key, value);
}
module.exports.setEnvironmentAttribute = setEnvironmentAttribute;

/**
 * Set an environment-scoped object
 *
 * @param barrel
 * @param obj the objectt
 * @returns {Promise|Promise<T>}
 */
function setEnvironmentAttributes(barrel, obj) {
    return setAttributes(barrel, getEnvironmentId(barrel), obj);
}
module.exports.setEnvironmentAttributes = setEnvironmentAttributes;

/**
 * Get the value of a environment-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getEnvironmentAttribute(barrel, key) {
    return getAttribute(barrel, getEnvironmentId(barrel), key);
}
module.exports.getEnvironmentAttribute = getEnvironmentAttribute;

/**
 * Get all the current attributes in the environment scope.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getEnvironmentAttributes(barrel) {
    return getAttributes(barrel, getEnvironmentId(barrel));
}
module.exports.getEnvironmentAttributes = getEnvironmentAttributes;

/**
 * Remove a environment-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeEnvironmentAttribute(barrel, key) {
    return removeAttribute(barrel, getEnvironmentId(barrel), key);
}
module.exports.removeEnvironmentAttribute = removeEnvironmentAttribute;

/**
 * Get all the current environment-scoped keys.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getEnvironmentAttributeKeys(barrel) {

    return getAttributeKeys(barrel, getEnvironmentId(barrel));
}
module.exports.getEnvironmentAttributeKeys = getEnvironmentAttributeKeys;

/**
 * Invalidate the current environment-scoped storage.  This should
 * generally be used for cleaning up the entire scope when it's no longer
 * valid. This probably shouldn't be used at all.
 * @deprecated
 */
function invalidateEnvironment(barrel) {
    //return invalidate(barrel, getEnvironmentId(barrel));
}
module.exports.invalidatEnvironment = invalidateEnvironment;