var validator = require('validator');
var uuid = require('node-uuid');
var assert = require('assert');
var tools = require('../lib/tools');

var title = 'Access Tokens';

describe(title, function () {

    describe('Query', function () {

        describe('valid token', function () {
            it('returns token', function (done) {
                var req = {};
                req.query = {access_token: uuid.v4()};
                assert(tools.getAccessToken(req));
                done();
            });
        });

        describe('invalid token (illegal chars and length)', function () {
            it('returns undefined', function (done) {
                var req = {};
                req.query = {access_token: 'asl;dfjalkd12341234'};
                assert(!tools.getAccessToken(req));
                done();
            });
        });
    });

    describe('Params', function () {

        describe('valid token', function () {
            it('returns token', function (done) {
                var req = {};
                req.params = {access_token: uuid.v4()};
                assert(tools.getAccessToken(req));
                done();
            });
        });

        describe('invalid token (illegal chars and length)', function () {
            it('returns undefined', function (done) {
                var req = {};
                req.params = {access_token: 'alert("this is javascript")'};
                assert(!tools.getAccessToken(req));
                done();
            });
        });
    });

    describe('Body', function () {

        describe('valid token', function () {
            it('returns token', function (done) {
                var req = {};
                req.body = {access_token: uuid.v4()};
                assert(tools.getAccessToken(req));
                done();
            });
        });

        describe('invalid token (illegal chars)', function () {
            it('returns undefined', function (done) {
                var req = {};
                req.body = {access_token: '6afb948f-!!!-432c-b276-52edaf750b1a'};
                assert(!tools.getAccessToken(req));
                done();
            });
        });
    });

    describe('Headers', function () {

        describe('valid token', function () {
            it('returns token', function (done) {
                var req = {};
                req.headers = {authorization: 'Bearer ' + uuid.v4()};
                assert(tools.getAccessToken(req));
                done();
            });
        });

        describe('invalid token (one extra character)', function () {
            it('returns undefined', function (done) {
                var req = {};
                req.headers = {authorization: 'Bearer fe64faf2-f165-41b1-a2f4-942d02c56521a'};
                assert(!tools.getAccessToken(req));
                done();
            });
        });
    });

});


