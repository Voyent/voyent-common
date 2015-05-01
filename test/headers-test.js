var assert = require('assert');
var tools = require('../lib/tools');
var config = require('../lib/config');

//Create a simple object for getting and setting headers that
//imitates how Express does it.
function MockRequest() {
    this.headers = {};
}

MockRequest.prototype.get = function (key) {
    return this.headers[key];
};


var title = 'Service Headers';

describe(title, function () {

    //console.log('compressing permission headers:', config.tools.compressPermissionHeaders);

    describe('username', function () {

        var req = new MockRequest();
        var username = 'johnsmith';

        it('set', function (done) {
            tools.setUserNameHeader(req, username);
            done();
        });

        it('get', function (done) {
            var result = tools.getUserNameHeader(req);
            assert.strictEqual(username, result);
            done();
        });

    });

    describe('user permissions', function () {

        var req = new MockRequest();
        var userPermissions = 'bridgeit.context.user.readSelf, bridgeit.context.user.writeSelf, bridgeit.context.user.readAny, bridgeit.context.user.writeAny, bridgeit.context.readSelf, bridgeit.context.writeSelf';
        var validPermission = 'bridgeit.context.user.readSelf';
        var invalidPermission = 'bridgeit.context.user.read';

        it('set', function (done) {
            tools.setUserPermissionsHeader(req, userPermissions);
            done();
        });

        it('get', function (done) {
            var result = tools.getUserPermissionsHeader(req);
            assert.strictEqual(userPermissions, result);
            done();
        });

        it('valid permission', function (done) {
            var result = tools.hasUserPermissionInHeader(req, validPermission);
            assert(result);
            done();
        });

        it('valid permission', function (done) {
            var result = tools.hasPermissionInHeader(req, validPermission);
            assert(result);
            done();
        });

        it('invalid permission', function (done) {
            var result = tools.hasUserPermissionInHeader(req, invalidPermission);
            assert(result === false);
            done();
        });

        it('invalid permission', function (done) {
            var result = tools.hasPermissionInHeader(req, invalidPermission);
            assert(result === false);
            done();
        });

    });

    describe('service token', function () {

        var req = new MockRequest();
        var token = '4ad88e4a-bbdc-412b-b532-6a18a6f43e35';

        it('set', function (done) {
            tools.setServiceTokenHeader(req, token);
            done();
        });

        it('get', function (done) {
            var result = tools.getServiceTokenHeader(req);
            assert.strictEqual(token, result);
            done();
        });

    });

    describe('service permissions', function () {

        var req = new MockRequest();
        var servicePermissions = 'bridgeit.context.user.readSelf, bridgeit.context.user.writeSelf, bridgeit.context.user.readAny, bridgeit.context.user.writeAny, bridgeit.context.readSelf, bridgeit.context.writeSelf';
        var validPermission = 'bridgeit.context.user.readSelf';
        var invalidPermission = 'bridgeit.context.user.read';

        it('set', function (done) {
            tools.setServicePermissionsHeader(req, servicePermissions);
            done();
        });

        it('get', function (done) {
            var result = tools.getServicePermissionsHeader(req);
            assert.strictEqual(servicePermissions, result);
            done();
        });

        it('valid permission', function (done) {
            var result = tools.hasServicePermissionInHeader(req, validPermission);
            assert(result);
            done();
        });

        it('valid permission', function (done) {
            var result = tools.hasPermissionInHeader(req, validPermission);
            assert(result);
            done();
        });

        it('invalid permission', function (done) {
            var result = tools.hasServicePermissionInHeader(req, invalidPermission);
            assert(result === false);
            done();
        });

        it('invalid permission', function (done) {
            var result = tools.hasPermissionInHeader(req, invalidPermission);
            assert(result === false);
            done();
        });

    });


});


