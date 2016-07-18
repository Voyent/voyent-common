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

var config = require('./config');
//config.env.hosts.db = 'localhost:27017';`
var assert = require('assert');

var db = require('./db');


var ICESOFT_TX_HEADER = 'com.icesoft.services.transaction.id';
var ICESOFT_PROCESS_HEADER = 'com.icesoft.services.process.id';
var ICESOFT_REQUEST_HEADER = "com.icesoft.services.request.id";

/**
 * Get a scope object. This is not meant for public consumption, instead, clients should use the
 * concrete methods (getRequestScope, getBackpackScope, etc. )
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

                        console.log('removeAttribute', key);

                        var removeAttribute = {};
                        removeAttribute[key] = null;

                        scopesCollection
                            .updateOne(
                            {_scopeId: scopeId},
                            {$unset: key})
                            .then(
                            function (result) {
                                console.log('removeAttribute', result);
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

function getHeader(barrel, headerName) {
    //TODO: make sure this is correct and robust
    return barrel.req.headers[headerName];
}

/**
 * mock method for setting header in barrel request
 * @param barrel
 * @param headerName
 * @param value
 */
function setHeader(barrel, headerName, value) {
    //TODO: make sure this is correct and robust
    barrel.req.headers[headerName] = value;
}

/**
 * retrieve the icesoft namespaced transactionId from the request object stored in the barrel.
 * @param barrel
 * @returns {*}
 */
function getTransactionId(barrel) {
    return getHeader(barrel, ICESOFT_TX_HEADER);
}


/**
 * Get the icesoft namespaced processId from the request object stored in the barrel
 * @param barrel
 * @returns {*}
 */
function getProcessId(barrel) {
    return getHeader(barrel, ICESOFT_PROCESS_HEADER);
}


function getScopeFromBarrel(barrel, scopeId) {
    return getScope(barrel.accountId, barrel.realmId, scopeId);
}

/**
 * Get a listing of all the scopes in the given account and realm
 * @param accountName The account name
 * @param realmName The realm
 * @returns {Promise}
 */
function getScopesDirectory(accountName, realmName) {

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
module.exports.getScopesDirectory = getScopesDirectory;

/**
 * Returns a promise for acquiring an API that can be used for
 * request scoped data. This is tracked by the current transaction code, which
 * is generated by authProxy when a request to one of the services is detected.
 * Downstream services place and consume variables in this scope, which is maintained by
 * passing the transaction code along in the request header
 *
 * @param barrel
 * @returns {Promise<T>|Promise}
 */
function getRequestScope(barrel) {
    return getScopeFromBarrel(barrel, getTransactionId(barrel));
}


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

function removeRequestAttribute(barrel, key) {

    return new Promise(function (resolve, reject) {

        console.log('removeRequestAttribute', key);

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
// -- End request scope block


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
 * Returns a promise for acquiring an API for operating on process scoped
 * information.
 *
 * @param barrel
 * @returns {Promise<T>|Promise}
 */
function getProcessScope(barrel) {
    return getScopeFromBarrel(barrel, getProcessId(barrel));
}


// TESTING

config.env.hosts.db = 'localhost:27017';

var fakeBarrel = {
    accountId: "scopesaccount",
    realmId: "scopesrealm",
    req: {
        headers: {
            ICESOFT_TX_HEADER: "scopesTransactionId",
            ICESOFT_PROCESS_HEADER: "scopesProcessId"
        }
    }
};

var scopeManualId = 'scopeManualId';
var requestScopeId = fakeBarrel.req.headers[ICESOFT_REQUEST_HEADER];
var processScopeId = fakeBarrel.req.headers[ICESOFT_PROCESS_HEADER];

//Test getting a scope
// getScope(fakeBarrel.accountId, fakeBarrel.realmId, scopeManualId)
//     .then(
//         function (scope) {
//             assert(scope);
//             assert.equal(scope.getId(), scopeId);
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );


//Test setting and getting a simple string value
// getScope(fakeBarrel.accountId, fakeBarrel.realmId, scopeManualId)
//     .then(
//         function (scope) {
//             assert(scope);
//             assert.equal(scope.getId(), scopeId);
//             scope.setAttribute('simpleStringKey', 'simpleStringValue')
//                 .then(
//                     function (setResult) {
//                         assert(setResult);
//                         console.log('setAttribute', setResult);
//                     }
//                 ).catch(
//                 function (err) {
//                     assert.ifError(err);
//                 }
//             );
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );


//Get a specific scope from information in the barrel
// getRequestScope(fakeBarrel)
//     .then(
//         function (scope) {
//             console.log('get request scope', scope.getId());
//         })
//     .catch(
//         function (err) {
//             console.log(err);
//         }
//     );


//Get a specific scope from information in the barrel
// getProcessScope(fakeBarrel)
//     .then(
//         function (scope) {
//             assert(scope);
//             assert(scope.getId());
//             assert.equal(scope.getId(), processScopeId);
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );


// setRequestAttribute(fakeBarrel, 'foo', 'bar')
//     .then(
//         function (setResult) {
//             assert(setResult);
//             console.log('set request attribute', setResult);
//             assert(setResult.foo);
//             assert.equal(setResult.foo === 'bar');
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );
//
//
// setRequestAttribute(fakeBarrel, 'yabba', 'dabba')
//     .then(
//         function (setResult) {
//             assert(setResult);
//             console.log('set request attribute', setResult);
//             assert(setResult.foo);
//             assert.equal(setResult.foo === 'bar');
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );
//
//
// getRequestAttribute(fakeBarrel, 'badOne')
//     .then(
//         function (getResult) {
//             assert(!getResult);
//             console.log('get request attribute (bad)', getResult);
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );

// removeRequestScopeAttribute(fakeBarrel, 'foo')
//     .then(
//         function (removeResult) {
//             assert(removeResult);
//             console.log('remove request attribute', removeResult);
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );


// getRequestAttributeKeys(fakeBarrel)
//     .then(
//         function (getResult) {
//             assert(getResult);
//             console.log('get request attribute keys', getResult);
//             assert.equal(getResult === 'bar');
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );
//
// invalidateRequest(fakeBarrel)
//     .then(
//         function (getResult) {
//             assert(getResult);
//             console.log('invalidate request', getResult);
//             assert.equal(getResult === 'bar');
//         })
//     .catch(
//         function (err) {
//             assert.ifError(err);
//         }
//     );


setRequestAttribute(fakeBarrel, 'aKey', 'aValue')
    .then(
    function (aResult) {
        console.log('setRequestAttribute a', aResult);
        getScopesDirectory(fakeBarrel.accountId, fakeBarrel.realmId)
            .then (
            function(availableScopes) {
                for (var i = 0; i< availableScopes.length; i++) {
                    console.log('scopes[' + i + '] = ', availableScopes[i]._scopeId);
                }
            });
    }
)
    .then(
    function (bResult) {
        setRequestAttribute(fakeBarrel, 'bKey', 'bValue')
            .then(
            function (val) {
                console.log('setRequestAttribute b', val);
            }
        );
    }
)
    .then(
    function (cResult) {
        setRequestAttribute(fakeBarrel, 'cKey', 'cValue')
            .then(
            function (val) {
                console.log('setRequestAttribute c', val);
            }
        );
    }
)
    .then(
    function (cResult) {
        getRequestAttribute(fakeBarrel, 'cKey')
            .then(
            function (val) {
                console.log('getRequestAttribute c', val);

            }
        );
    }
)
    .then(
    function (dResult) {
        getRequestAttributeKeys(fakeBarrel)
            .then(
            function (val) {
                console.log('getRequestAttributeKeys', val);
            }
        );
    }
)
    .then(
    function (eResult) {
        removeRequestAttribute(fakeBarrel, 'cKey')
            .then(
            function (val) {
                console.log('removeRequestAttribute c', val);
            }
        );
    }
)
    .then(
    function (fResult) {
        getRequestAttributeKeys(fakeBarrel)
            .then(
            function (val) {
                console.log('getRequestAttributeKeys', val);
            }
        );
    }
)
    .then(
    function (gResult) {
        setHeader(fakeBarrel, ICESOFT_TX_HEADER, 'processScope');
        setRequestAttribute(fakeBarrel, 'aManualKey', 'aManualValue')
            .then(
            function (val) {
                console.log('setRequestAttributeKeys', val);
            }
        );
    }
    )
    .then(

    function (hresult) {
        console.log('getting scope directory: ');
        getScopesDirectory(fakeBarrel.accountId, fakeBarrel.realmId)
            .then(
            function(availableScopes) {
                for (var i = 0; i< availableScopes.length; i++) {
                    console.log('scopes[' + i + '] = ', availableScopes[i]._scopeId);
                }
            });

    }
)
    .then(
    function (gResult) {
        setTimeout(function(){
            process.exit(0);
        }, 3000);
    }
)
;
