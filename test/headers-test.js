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

    var req;

    var username = 'johnsmith';
    var token = '4ad88e4a-bbdc-412b-b532-6a18a6f43e35';

    var userPermissions = 'bridgeit.context.user.readSelf, bridgeit.context.user.readAny, bridgeit.context.readStuff';
    var userPermission = 'bridgeit.context.user.readSelf';

    var servicePermissions = 'bridgeit.context.user.writeSelf, bridgeit.context.user.writeAny, bridgeit.context.writeStuff';
    var servicePermission = 'bridgeit.context.user.writeSelf';

    var unknownPermission = 'bridgeit.context.user.bad';

    var anyButNotAllPermissions = 'bridgeit.context.user.readSelf, bridgeit.context.user.read';
    var noPermissions = 'bridgeit.context.user.read, bridgeit.context.user.write';
    var allPermissions = 'bridgeit.context.user.readSelf, bridgeit.context.user.writeSelf';

    before(function (done) {
        req = new MockRequest();
        tools.setUserNameHeader(req, username);
        tools.setServiceTokenHeader(req, token);
        tools.setUserPermissionsHeader(req, userPermissions);
        tools.setServicePermissionsHeader(req, servicePermissions);
        done();
    });

    describe('username', function () {

        it('get', function (done) {
            var result = tools.getUserNameHeader(req);
            assert.strictEqual(username, result);
            done();
        });

    });

    describe('service token', function () {

        it('get', function (done) {
            var result = tools.getServiceTokenHeader(req);
            assert.strictEqual(token, result);
            done();
        });

    });

    describe('user permissions', function () {

        it('get', function (done) {
            var result = tools.getUserPermissionsHeader(req);
            assert.strictEqual(userPermissions, result);
            done();
        });

        it('valid permission', function (done) {
            var result = tools.hasUserPermissionInHeader(req, userPermission);
            assert(result === true);
            done();
        });

        it('invalid permission', function (done) {
            var result = tools.hasUserPermissionInHeader(req, servicePermission);
            assert(result === false);
            done();
        });

    });

    describe('service permissions', function () {

        it('get', function (done) {
            var result = tools.getServicePermissionsHeader(req);
            assert.strictEqual(servicePermissions, result);
            done();
        });

        it('valid permission', function (done) {
            var result = tools.hasServicePermissionInHeader(req, servicePermission);
            assert(result === true);
            done();
        });

        it('invalid permission', function (done) {
            var result = tools.hasServicePermissionInHeader(req, userPermission);
            assert(result === false);
            done();
        });

    });


    describe('general permissions', function () {

        it('user permission', function (done) {
            var result = tools.hasPermissionInHeader(req, userPermission);
            assert(result === true);
            done();
        });

        it('service permission', function (done) {
            var result = tools.hasPermissionInHeader(req, servicePermission);
            assert(result === true);
            done();
        });

        it('invalid permission', function (done) {
            var result = tools.hasPermissionInHeader(req, unknownPermission);
            assert(result === false);
            done();
        });

        it('has any permission', function (done) {
            var result = tools.hasAnyPermissionsInHeaders(req, anyButNotAllPermissions);
            assert(result === true);
            done();
        });

        it('has no permission', function (done) {
            var result = tools.hasAnyPermissionsInHeaders(req, noPermissions);
            assert(result === false);
            done();
        });

        it('has all permissions', function (done) {
            var result = tools.hasAllPermissionsInHeaders(req, allPermissions);
            assert(result === true);
            done();
        });

        it('not all permissions', function (done) {
            var result = tools.hasAllPermissionsInHeaders(req, anyButNotAllPermissions);
            assert(result === false);
            done();
        });

    });

});


