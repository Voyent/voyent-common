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

var TRANSACTION_HEADER_KEY = 'com.icesoft.services.transaction.id';
module.exports.TRANSACTION_HEADER_KEY = TRANSACTION_HEADER_KEY;

var PROCESS_HEADER_KEY = 'com.icesoft.services.process.id';
module.exports.PROCESS_HEADER_KEY = PROCESS_HEADER_KEY;

//For the purposes of the service scope, a "request" and a "transaction" are the same.  Each 
//request to our services is assigned a transactionId that travels through all relevant services
//and is the id which is used to store any request/transaction scoped data.
// var ICESOFT_REQUEST_HEADER = "com.icesoft.services.request.id";

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
 * @returns {Promise}
 */
function getScope(accountName, realmName, scopeIdentifier) {

    return new Promise(function (resolve, reject) {

        var scopeId = scopeIdentifier;

        if (!scopeId) {
            reject('missing scope identifier');
        }

        db.getCollection(accountName, realmName, 'scopes', function (err, scopesCollection) {

            if (err) {
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

                        scopesCollection
                            .updateOne(
                                {_scopeId: scopeId},
                                {$set: updateAttribute},
                                {upsert: true})
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

                getAttribute: function (key) {

                    return new Promise(function (resolve, reject) {

                        scopesCollection
                            .find({_scopeId: scopeId})
                            .toArray()
                            .then(
                                function (result) {
                                    if (result[0] && result[0][key]) {
                                        resolve(result[0][key]);
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
                        scopesCollection
                            .find({_scopeId: scopeId})
                            .project({_id: 0, _scopeId: 0})
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

function getScopeFromBarrel(barrel, scopeId) {
    return getScope(barrel.accountId, barrel.realmId, scopeId);
}


function setAttribute(barrel, scopeId, key, value) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId)
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

function getAttribute(barrel, scopeId, key) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId)
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

function removeAttribute(barrel, scopeId, key) {

    return new Promise(function (resolve, reject) {

        getScopeFromBarrel(barrel, scopeId)
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
    return barrel.req.headers[headerName];
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
    return getHeader(barrel, TRANSACTION_HEADER_KEY);
}

/**
 * Set a transaction-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setTransactionAttribute(barrel, key, value) {
    return setAttribute(barrel, getTransactionId(barrel), key, value);
}
module.exports.setTransactionAttribute = setTransactionAttribute;


/**
 * Get the value of a transaction-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getTransactionAttribute(barrel, key) {
    return getAttribute(barrel, getTransactionId(barrel), key);
}
module.exports.getTransactionAttribute = getTransactionAttribute;


/**
 * Remove a transaction-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeTransactionAttribute(barrel, key) {
    return removeAttribute(barrel, getTransactionId(barrel), key);
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
// PROCESS SCOPE
// -------------------------
 
/**
 * Get the process id header from the request object stored in the barrel.
 *
 * @param barrel
 * @returns The current process id (if there is one).
 */
function getProcessId(barrel) {
    return getHeader(barrel, PROCESS_HEADER_KEY);
}

