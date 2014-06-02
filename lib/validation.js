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
var usernameRegex = /^[A-Za-z0-9_@\.]*$/;    // ascii printable plus enough to enter email, and underscores
var passwordRegex = /^[A-Za-z0-9!@#%^&*_\s]*$/;    // A few more punctuation chars.

var firstLastNameRegex = /^[$!{}]/;
var spaceAndLimitedPunctuationRegex = /^[A-Za-z0-9\.\s!#@$%^&*]*$/;
var serviceNameRegex = /^[A-Za-z0-9\.]*$/;
var spaceOnlyRegex = /^[A-Za-z0-9\s]*$/;

var PermissionStringLength = 100;
var DescriptionStringLength = 256;
var RealmMaxLength = 75;
var RealmMinLength = 2;
var RolesMaxLength = 75;
var RolesMinLength = 75;
var PasswordMinLength = 8;
var PasswordMaxLength = 48;
var EmailMaxLength = 50;
var ServiceMaxLength = 50;

var NameMaxLength = 30;
var NameMinLength = 1;

/**
 * For example, min length 8, max length: 30, no punctuation other than the subrealm
 * seperator '.'
 * @param val The realm name to test
 * @return true if ok, false if failed
 */
var realmValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length < RealmMinLength || val.length > RealmMaxLength) {
        return false;
    }
    return spaceAndPeriodRegex.test(val);
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

var booleanValidator = function (val) {
    if (typeof(val) !=='boolean') {
        return false;
    }
    if (true !== val && false !== val) {
        return false;
    }
    return true;
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
//    if (typeof(val) !=='object' ) {
//        return false;
//    }
    /*
     for(var propertyName in query) {
     if (query.hasOwnProperty(propertyName)) {

     console.log('Found property name: ' + propertyName);
     if ('access_token' == propertyName) {
     continue;
     }
     var value = query[propertyName];
     if (typeof(value) !=='string') {
     console.log('B');
     return false;
     }
     if (!spaceOnlyRegex.test(value)) {
     console.log('C');

     return false;
     }
     }
     }
     */
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
            logger.debug('Service name invalid');
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
 * Check that the format of the permissions array is correct. This should be
 * done prior to doing the account type validation
 */
var rolesFormatValidator = function (val) {
    if (Array.isArray(val) === false) {
        return false;
    }
    var pass = true;
    for (var i = 0; i < val.length; i++) {
        if (!val[i] || val[i].length > RolesMaxLength) {
            return false;
        }
        if (!serviceNameRegex.test(val[i])) {
            pass = false;
        }
    }
    return pass;
};
exports.rolesFormatValidator = rolesFormatValidator;
