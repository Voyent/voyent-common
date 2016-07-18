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

/**
 * Extracts the request from the barrel and uses that request to get
 * the value of the provided header.
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
 * Get the transaction id header from the request object stored in the barrel.
 *
 * @param barrel
 * @returns {*}
 */
function getTransactionId(barrel) {
    return getHeader(barrel, TRANSACTION_HEADER_KEY);
}


/**
 * Get the process id header from the request object stored in the barrel.
 *
 * @param barrel
 * @returns {*}
 */
function getProcessId(barrel) {
    return getHeader(barrel, PROCESS_HEADER_KEY);
}

/**
 * General utility method that gets any scope from this account/realm
 * based on the scopeId passed in.
 *
 * @param barrel
 * @param scopeId
 * @returns {Promise}
 */
function getScopeFromBarrel(barrel, scopeId) {
    return getScope(barrel.accountId, barrel.realmId, scopeId);
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

/**
 * Returns a Promise for acquiring an API that can be used for request/transaction scoped
 * data. This is tracked by the current transaction code, which is generated by authProxy
 * when a request to one of the services is initially received. Downstream services can
 * place and consume variables in this scope, which is maintained by passing the transaction
 * code along in the request header (if using an HTTP request) or via the event payload (if
 * listening for an Event).
 *
 * @param barrel
 * @returns {Promise<T>|Promise}
 */
function getRequestScope(barrel) {
    return getScopeFromBarrel(barrel, getTransactionId(barrel));
}

/**
 * Set a request/transaction-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @param value
 * @returns {Promise|Promise<T>}
 */
function setRequestAttribute(barrel, key, value) {

    return new Promise(function (resolve, reject) {

        getRequestScope(barrel)
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
module.exports.setRequestAttribute = setRequestAttribute;


/**
 * Get the value of a request/transaction-scoped attribute.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function getRequestAttribute(barrel, key) {

    return new Promise(function (resolve, reject) {

        getRequestScope(barrel)
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
module.exports.getRequestAttribute = getRequestAttribute;


/**
 * Remove a request/transaction-scoped key/value pair.
 *
 * @param barrel
 * @param key
 * @returns {Promise|Promise<T>}
 */
function removeRequestAttribute(barrel, key) {

    return new Promise(function (resolve, reject) {

        getRequestScope(barrel)
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
module.exports.removeRequestAttribute = removeRequestAttribute;

/**
 * Get all the current request/transaction-scoped keys.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function getRequestAttributeKeys(barrel) {

    return new Promise(function (resolve, reject) {

        getRequestScope(barrel)
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
module.exports.getRequestAttributeKeys = getRequestAttributeKeys;

/**
 * Invalidate the current request/transaction scoped storage.  This should
 * generally be used for cleaning up the entire scope when it's no longer
 * valid.
 *
 * @param barrel
 * @returns {Promise|Promise<T>}
 */
function invalidateRequest(barrel) {

    return new Promise(function (resolve, reject) {

        getRequestScope(barrel)
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
 * Returns a Promise for acquiring an API that can be used for process-scoped
 * data. This is tracked by a process code, which is generated by the Process service
 * when a process is started. Downstream services can place and consume variables in
 * this scope, which is maintained by passing the process code along in the request header
 * (if using an HTTP request) or via the event payload (if listening for an Event).
 *
 * @param barrel
 * @returns {Promise<T>|Promise}
 */
function getProcessScope(barrel) {
    return getScopeFromBarrel(barrel, getProcessId(barrel));
}

//For most other scopes (realm, backpack/action, etc.) the code should mostly be a an exercise
//in copy and paste but this seems highly inefficient so we'll look at improving this part.