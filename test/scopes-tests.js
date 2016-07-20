var config = require('../lib/config');
config.env.hosts.db = 'localhost:27017';

var assert = require('assert');
var scopes = require('../lib/scopes');


describe('scopes', function () {

//Just set common account/realm information for all testing.
    var accountId = "scopesaccount";
    var realmId = "scopesrealm";

    var testAttributeKey = "testAttributeKey";
    var testAttributeValue = "testAttributeValue";
    var anotherAttributeKey = "anotherAttributeKey";
    var anotherAttributeValue = "anotherAttributeValue";

    describe('transaction', function () {

        var transactionScopeId = "transactionId";

        var fakeBarrel = {
            accountId: accountId,
            realmId: realmId,
            req: {
                headers: {
                    "com.icesoft.services.transaction.id": transactionScopeId
                }
            }
        };

        it('invalidate', function () {
            return scopes.invalidateTransaction(fakeBarrel)
                .then(
                    function (invalidatedTransactionId) {
                        assert(invalidatedTransactionId);
                        assert.equal(invalidatedTransactionId, transactionScopeId);
                    });
        });

        it('get non-existent key', function () {
            return scopes.getTransactionAttribute(fakeBarrel, testAttributeKey)
                .then(
                    function (noValue) {
                        assert(!noValue);
                    });
        });

        it('set first attribute', function () {
            return scopes.setTransactionAttribute(fakeBarrel, testAttributeKey, testAttributeValue)
                .then(
                    function (setAttribute) {
                        assert(setAttribute);
                        assert(setAttribute[testAttributeKey]);
                        assert.equal(setAttribute[testAttributeKey], testAttributeValue);
                        assert.equal(Object.keys(setAttribute).length, 1);
                    });
        });

        it('get first attribute', function () {
            return scopes.getTransactionAttribute(fakeBarrel, testAttributeKey)
                .then(
                    function (getValue) {
                        assert(getValue);
                        assert.strictEqual(getValue, testAttributeValue);
                    });
        });

        it('set second attribute', function () {
            return scopes.setTransactionAttribute(fakeBarrel, anotherAttributeKey, anotherAttributeValue)
                .then(
                    function (setAttribute) {
                        assert(setAttribute);
                        assert(setAttribute[anotherAttributeKey]);
                        assert.strictEqual(setAttribute[anotherAttributeKey], anotherAttributeValue);
                    });
        });

        it('get second attribute', function () {
            return scopes.getTransactionAttribute(fakeBarrel, anotherAttributeKey)
                .then(
                    function (getValue) {
                        assert(getValue);
                        assert.strictEqual(getValue, anotherAttributeValue);
                    });
        });

        it('get 2 keys', function () {
            return scopes.getTransactionAttributeKeys(fakeBarrel)
                .then(
                    function (getKeys) {
                        assert(getKeys);
                        assert.equal(getKeys.length, 2);
                    });
        });

        it('remove second attribute', function () {
            return scopes.removeTransactionAttribute(fakeBarrel, anotherAttributeKey)
                .then(
                    function (removedValue) {
                        assert(removedValue);
                        assert.equal(removedValue, anotherAttributeKey);
                    });
        });

        it('get 1 key', function () {
            return scopes.getTransactionAttributeKeys(fakeBarrel)
                .then(
                    function (getKeys) {
                        assert(getKeys);
                        assert.equal(getKeys.length, 1);
                    });
        });

        it('get removed attribute', function () {
            return scopes.getTransactionAttribute(fakeBarrel, anotherAttributeKey)
                .then(
                    function (noValue) {
                        assert(!noValue);
                    });
        });

        it('touch', function () {
            return scopes.touchTransaction(fakeBarrel)
                .then(
                    function (touched) {
                        assert(touched);
                        assert(touched[scopes.TRANSACTION_LAST_ACCESSED]);
                    });
        });

    });

});