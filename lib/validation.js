var validator = require('validator');
var config = require('./config');

/**
 * Shared validation functions for validating various fields.
 * These functions, being in a common library, may not be used
 * for project specific validations and techniques, such as using
 * the project database module to perform various lookups. Those
 * validation tasks are best left to a project specific validation module
 */
var spaceAndPeriodRegex = /^[A-Za-z0-9\.\s]*$/;
var spacePeriodAndUnderscoreRegex = /^[A-Za-z0-9_\.\s]*$/;
var usernameRegex = /^[A-Za-z0-9_@\.]*$/;    // ascii printable plus enough to enter email, and underscores
var passwordRegex = /^[A-Za-z0-9!@#%^&*_\s]*$/;    // A few more punctuation chars.

var firstLastNameRegex = /^[$!{}]/;
var spaceAndLimitedPunctuationRegex = /^[A-Za-z0-9\.\s,!#@$%^&*]*$/;
var serviceNameRegex = /^[A-Za-z0-9\.]*$/;
var spaceOnlyRegex = /^[A-Za-z0-9\s]*$/;
var underscoreOnlyRegex = /^[A-Za-z0-9_]*$/;

var PermissionStringLength = 100;
var DescriptionStringLength = 256;
var RealmMaxLength = 75;
var RealmMinLength = 2;
var RolesMaxLength = 75;
var OriginsMaxLength = 100;
var RolesMinLength = 75;
var PasswordMinLength = 8;
var PasswordMaxLength = 48;
var EmailMaxLength = 50;
var ServiceMaxLength = 50;

var NameMaxLength = 30;
var NameMinLength = 1;

/**
 * For example, min length 8, max length: 30, no punctuation other than the subrealm
 * separator '.' and '_' and ' '.
 * @param val The realm name to test
 */
var realmValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length < RealmMinLength || val.length > RealmMaxLength) {
        return false;
    }
    return spacePeriodAndUnderscoreRegex.test(val);
};
exports.realmValidator = realmValidator;

// Username validator. Valid chars are ascii character ranges plus a few punctuation
// characters for email addresses as username.
var usernameValidator = function (val) {

    //In order to have modules respect the logging configuration supplied by the service, we
    //need to get the logger in a 'lazy' fashion.  If we get it during initialization, then
    //the logger instance only has the default configuration.
    var logger = require('./loggers').getLogger();

    if (typeof(val) !=='string') {
        logger.debug('Username invalid type');
        return false;
    }
    if (val.length < NameMinLength || val.length > NameMaxLength) {
        logger.debug('Username invalid length');
        return false;
    }
    var result = usernameRegex.test(val);
    return result;
};
exports.usernameValidator = usernameValidator;


// First, last name validator
var nameValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length < NameMinLength || val.length > NameMaxLength) {
        return false;
    }
    // Allow all unicode chars for name fields.
    return !firstLastNameRegex.test(val);
};
exports.nameValidator = nameValidator;

// accountname validator.
var accountNameValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length < NameMinLength || val.length > NameMaxLength) {
        return false;
    }
    return spaceAndPeriodRegex.test(val);
};
exports.accountNameValidator = accountNameValidator;

// Account description validator
var descriptionValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length > DescriptionStringLength) {
        return false;
    }
    return spaceAndLimitedPunctuationRegex.test(val);
};
exports.descriptionValidator = descriptionValidator;

var serviceNameValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length > ServiceMaxLength) {
        return false;
    }
    return serviceNameRegex.test(val);
};
exports.serviceNameValidator = serviceNameValidator;

var serviceArrayValidator = function(val) {
    if (Array.isArray(val) === false) {
        return false;
    }
    var service;
    for (var i = 0; i < val.length; i ++) {
        service = val[i];
        if (!serviceNameValidator(service)) {
            return false;
        }
    }
    return true;
}
exports.serviceArrayValidator = serviceArrayValidator;

var booleanValidator = function (val) {
    if (typeof(val)==='boolean') {
        if (true !== val && false !== val) {
            return false;
        }
        return true;
    } else if (typeof(val)==='string') {
        if ('true'!= val && 'false' != val){
            return false;
        }
        return true;
    }
    return false;
};
exports.booleanValidator = booleanValidator;

var passwordValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length < PasswordMinLength || val.length > PasswordMaxLength) {
        return false;
    }
    return passwordRegex.test(val);
};
exports.passwordValidator = passwordValidator;


var emailValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length > EmailMaxLength) {
        return false;
    }
    return validator.isEmail(val);
};
exports.emailValidator = emailValidator;


var queryValidator = function (query) {
    // Todo
    return true;
};
exports.queryValidator = queryValidator;

/**
 * Check that the format of the permissions array is correct. This should be
 * done prior to doing the account type validation
 */
var permissionFormatValidator = function (val) {

    //In order to have modules respect the logging configuration supplied by the service, we
    //need to get the logger in a 'lazy' fashion.  If we get it during initialization, then
    //the logger instance only has the default configuration.
    var logger = require('./loggers').getLogger();

    if (Array.isArray(val) === false) {
        logger.debug('Permission set not an array: ' + typeof(val));
        return false;
    }
    for (var i = 0; i < val.length; i++) {
        if (typeof(val[i]) !=='string') {
            logger.debug('Permission not a string: ' + typeof(val[i]));
            return false;
        }
        if (val[i].length > PermissionStringLength) {
            logger.debug('Invalid permission length: ' + val[i].length);
            return false;
        }
        if (!serviceNameRegex.test(val[i])) {
            logger.debug('Permission name invalid: ' + val[i]);
            return false;
        }
    }
    return true;
};
exports.permissionFormatValidator = permissionFormatValidator;

/**
 * Check that the format of the realm reference array is correct.
 * @param val An array of permission strings
 */
var realmReferenceFormatValidator = function (val) {
    if (Array.isArray(val) === false) {
        return false;
    }
    for (var i = 0; i < val.length; i++) {
        if (typeof(val[i]) !=='string') {
            return false;
        }
        if (!val[i] || val[i].length > RealmMaxLength) {
            return false;
        }
        if (!spaceAndPeriodRegex.test(val[i])) {
            return false;
        }
    }
    return true;
};
exports.realmReferenceFormatValidator = realmReferenceFormatValidator;

/**
 * Check the format of a role definition
 * Check the
 * @param val is an object of the form { rolename: 'yadda', permissions: [ 'permissiona', 'permissionb' ]
 */
var roleFormatValidator = function (val) {

    if (typeof(val.rolename) !== 'string') {
        return false;
    }
    if (val.rolename.length > RolesMaxLength) {
        return false;
    }
    var check = rolenameValidator(val.rolename);
    if (!check) {
        return false;
    }
    // defer the permissions check to the permissionFormat checker
    check = permissionFormatValidator(val.permissions);
    return check;
};
exports.roleFormatValidator = roleFormatValidator;

/**
 * Check that the format of a rolename is proper.
 */
var rolenameValidator = function (val) {
    if (typeof(val) !== 'string') {
        return false;
    }
    if (val.length > RolesMaxLength) {
        return false;
    }
    return (underscoreOnlyRegex.test(val));
};
exports.rolenameValidator = rolenameValidator;

/**
 * This validator is for User/Admin records being granted access
 * to an array of roles by name
 */
var roleReferenceValidator = function (val) {
    if (Array.isArray(val) === false) {
        return false;
    }
    for (var i = 0; i < val.length; i++) {
        if (!val[i] || val[i].length > RolesMaxLength) {
            return false;
        }
        if (!underscoreOnlyRegex.test(val[i])) {
            return false;
        }
    }
    return true;
};
exports.roleReferenceValidator = roleReferenceValidator;


/**
 * Check that the format of the origins array is correct. This should be done as
 * part of the realm validation
 *
 * The origin array can contain a series of domains which need to be validated.
 *
 */
var originsArrayFormatValidator = function(val) {
    if (Array.isArray(val) == false) {
        var logger = require('./loggers').getLogger();
        logger.debug('Origins value is not array');
        return false;
    }
    var pass = true;
    var originField;
    for (var i = 0; i < val.length; i++) {
        if (typeof (val[i]) !== 'string' ) {
            return false;
        }
        if (val[i].length <= 0 || val[i].length > OriginsMaxLength) {
            return false;
        }
        // wildcard doesn't fit URL scheme
        if (val[i].indexOf('*') > -1) {
            continue;
        }
        pass = validator.isURL( val[i] );
        if (!pass) {
            return false;
        }
    }
    return true;

};
exports.originsArrayFormatValidator = originsArrayFormatValidator;
