var validator = require('validator');
var assert = require('assert');
var tools = require('../lib/tools');

var title = 'Permissions';

describe(title, function () {

    describe('Query', function () {

        describe('valid permissions', function () {
            it('returns permissions', function (done) {
                var req = {};
                req.query = {permissions: 'bridgeit.push.cloud bridgeit.auth.token'};
                assert(tools.getPermissions(req));
                done();
            });
        });

        describe('invalid permissions (illegal chars)', function () {
            it('returns undefined', function (done) {
                var req = {};
                req.query = {permissions: 'bridgeit.push.cloud (&)&(*)(&)(&%'};
                assert(!tools.getPermissions(req));
                done();
            });
        });
    });

    describe('Params', function () {

        describe('valid permissions', function () {
            it('returns permissions', function (done) {
                var req = {};
                req.params = {permissions: 'bridgeit.push.cloud bridgeit.auth.token'};
                assert(tools.getPermissions(req));
                done();
            });
        });

        describe('invalid permissions (illegal chars)', function () {
            it('returns undefined', function (done) {
                var req = {};
                req.params = {permissions: 'alert("hacking attempt in progress")'};
                assert(!tools.getPermissions(req));
                done();
            });
        });
    });

    describe('Body', function () {

        describe('valid permissions', function () {
            it('returns permissions', function (done) {
                var req = {};
                req.body = {permissions: 'bridgeit.push.cloud bridgeit.auth.token'};
                assert(tools.getPermissions(req));
                done();
            });
        });

        describe('invalid permissions (illegal chars)', function () {
            it('returns undefined', function (done) {
                var req = {};
                req.body = {permissions: 'bridgeit.push.cloud bridgeit.$auth.token'};
                assert(!tools.getPermissions(req));
                done();
            });
        });
    });

});


