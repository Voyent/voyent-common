var validator = require('validator');
var config = require('./config');
var errors = require('./errors');

/**
 * Shared validation functions for validating various fields.
 * These functions, being in a common library, may not be used
 * for project specific validations and techniques, such as using
 * the project database module to perform various lookups. Those
 * validation tasks are best left to a project specific validation module
 */
var spaceAndPeriodRegex = /^[A-Za-z0-9\.\s]*$/;
var spacePeriodAndUnderscoreRegex = /^[A-Za-z0-9_\.\s]*$/;
var periodAndUnderscoreRegex = /^[A-Za-z0-9_\.]*$/;
var usernameRegex = /^[A-Za-z0-9_@\.]*$/;    // ascii printable plus enough to enter email, and underscore
var passwordRegex = /^[A-Za-z0-9!@#%^&*_\s]*$/;    // A few more punctuation chars.
var subjectRegex = /^[A-Za-z0-9!?_\.\s]*$/;    // A few more punctuation chars.


var firstLastNameRegex = /^[$!{}]/;
var spaceAndLimitedPunctuationRegex = /^[A-Za-z0-9\.\s,!#@$%^&?*]*$/;
var serviceNameRegex = /^[A-Za-z0-9\.]*$/;
var spaceOnlyRegex = /^[A-Za-z0-9\s]*$/;
var underscoreOnlyRegex = /^[A-Za-z0-9_]*$/;
var underscoreSpaceOnlyRegex = /^[A-Za-z0-9_\s]*$/;
var permissionOpRegex = /[and|or|single]/;
var lowerCaseDotRegex = /^[a-z\.]*$/;

// read, execute, update, delete, readMeta, updateMeta, readPermissions, updatePermissions
var allowableRightsRegex = /[r|x|u|d|mu|pr|pu]/;

var PermissionStringLength = 100;
var DescriptionStringLength = 500;
var MaxRightsLength = 4000;
var RealmMaxLength = 75;
var RealmMinLength = 2;
var RolesMaxLength = 75;
var GroupsMaxLength = 75;
var OriginsMaxLength = 100;
var PasswordMinLength = 8;
var PasswordMaxLength = 48;
var EmailMaxLength = 50;
var ServiceMaxLength = 50;
var PermissionOpMaxLength = 6;
const groupIdStringLength = 80;
var serviceTypeMaxLength = 32;
var MAX_TEMPLATE_LENGTH = 65536;
var MAX_SUBJECT_LENGTH = 78; // RFC-2822
var MAX_EXPIRESIN_LENGTH = 10;  // number of ascii characters that is enough?

var NameMaxLength = 40;

/**
 * For example, min length 8, max length: 30, no punctuation other than the subrealm
 * separator '.' and '_'
 * @param val The realm name to test
 */
var realmValidator = function (val) {
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length < RealmMinLength || val.length > RealmMaxLength) {
        return false;
    }
    return periodAndUnderscoreRegex.test(val);
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
    if (val.length == 0 || val.length > NameMaxLength) {
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
    if (val.length > NameMaxLength) {
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
    if (val.length == 0 || val.length > NameMaxLength) {
        return false;
    }
    return spacePeriodAndUnderscoreRegex.test(val);
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
    return true;
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
};
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

var numericValidator = function (val) {

    var testNum = val;
    if (typeof (testNum) == String) {
        try {
            testNum = parseInt(val);
        } catch (e) {
            return false;
        }
    }
    return (typeof testNum === "number");
};
exports.numericValidator = numericValidator;

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
 * Check that the format of the group FK id array is correct.
 */
var groupFKFormatValidator = function (val) {

    var logger = require('./loggers').getLogger();

    if (Array.isArray(val) === false) {
        logger.debug('Group FK field is not an array: ' + typeof(val));
        return false;
    }
    for (var i = 0; i < val.length; i++) {
        if (typeof(val[i]) !=='string') {
            logger.debug('Group FK value is not a string: ' + typeof(val[i]));
            return false;
        }
        if (val[i].length > groupIdStringLength) {
            logger.debug('Invalid groupId reference length: ' + val[i].length);
            return false;
        }
    }
    return true;
};
exports.groupFKFormatValidator = groupFKFormatValidator;

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
 * Check that the format of the user reference array is correct.
 * @param val An array of username strings
 */
var usernameReferenceValidator = function (val) {
    if (Array.isArray(val) === false) {
        return false;
    }
    for (var i = 0; i < val.length; i++) {
        if (typeof(val[i]) !=='string') {
            return false;
        }
        if (!usernameValidator(val[i])) {
            return false;
        }
    }
    return true;
};
exports.usernameReferenceValidator = usernameReferenceValidator;

/**
 * Check the format of a role definition
 * @deprecate This function validates a role format that no longer exists
 *
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
 * Check that the format of a groupname is proper.
 */
var groupnameValidator = function (val) {
    return  (typeof(val) === 'string' && val.length <= GroupsMaxLength);
};
exports.groupnameValidator = groupnameValidator;


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
 * This validator is to validate the context registration 'service'
 * section. This currently contains a 'type' property which may be
 * anything, but shouldn't be goofy or too long.
 */
var registrationSectionValidation = function(val) {
    if (!val.type) {
        return false;
    }
    if (typeof(val.type) !== 'string') {
        return false;
    }
    if (val.type.length > ServiceMaxLength) {
        return false;
    }
    return lowerCaseDotRegex.test(val.type);
};
exports.registrationSectionValidation = registrationSectionValidation;

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

/**
 * Validate the format of the batch permission request. The batch permissions
 * is an array of named objects that encapsulate a name, a set of permissions, and an optional
 * operation. eg.
 * [ { name: 'some_name',
 *     permission: ['bridget.auth.viewUser'],
 *     op: 'and', 'or', 'single'
 *   }]
 *
 *   The returnValue is a series of named values.
 *
 */
function validateBatchPermissions(rawPermissions) {

    var logger = require('./loggers').getLogger();
    logger.debug('Validate Batch Permissions permissions follow:');
    logger.debug(rawPermissions);

    for (var i = 0; i < rawPermissions.length; i++) {
        var permStruct = rawPermissions[i];
        if (!permStruct.name || !rolenameValidator(permStruct.name)) {
            throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Permission entry must have name');
        }
        if ( ('string' != typeof (permStruct.permission)) && (!Array.isArray(permStruct.permission))) {
            throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Permissions value must be string or array of string');
        }
        // If perms are array, check that all elements are strings. No nested Arrays for you!
        if (Array.isArray(permStruct.permission) ) {
            for (var v = 0; v < permStruct.permission.length; v++ ) {
                if ('string' != typeof(permStruct.permission[v])) {
                    throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Nested permissions arrays not allowed');
                }
            }
        }
        if (!permStruct.op) {
            if ('string' == typeof (permStruct.permission)) {
                permStruct.op = 'and';
            }
            if (Array.isArray(permStruct.permission)) {
                permStruct.op = 'single';
            }
        }
        if (!permissionOpValidator(permStruct.op)) {
            throw new errors.BadRequestDetailsError('invalidPermissionsFormat', 'Invalid permission op field: ' + permStruct.op);
        }
    }
    return rawPermissions;
}
exports.validateBatchPermissions = validateBatchPermissions;

/**
 * Validate that the portion of the rootURI passed in is a valid URI
 *
 * @param val The validation root URI
 * @returns {boolean} true if the URI is a valid URL
 */
module.exports.rootURIValidator = function(val) {
    if (!val) {
        return false;
    }
    var options = { protocols: ['http', 'https' ] };
    //URL. options is an object which defaults to
    // {protocols: ['http','https','ftp'],
    //   require_tld: true,
    //   require_protocol: false,
    //   require_host: true,
    //   require_valid_protocol: true,
    //   allow_underscores: false,
    //   host_whitelist: false,
    //   host_blacklist: false,
    //   allow_trailing_dot: false,
    //   allow_protocol_relative_urls: false
    // }
    return validator.isURL(val, options);
};


/**
 * Validate that the portion of the rootURI passed in is a valid URI
 *
 * @param val The validation root URI
 * @returns {boolean} true if the URI is a valid URL
 */
module.exports.expiresInValidator = function(val) {
    if (!val) {
        return true;
    }
    if (typeof(val) !== 'string') {
        return false;
    }
    if (val.length > MAX_EXPIRESIN_LENGTH) {
        return false;
    }
    try {
        var v = parseInt(val);
    } catch (e) {
        return false;
    }
    return true;
};


/**
 * Validate an email template value. It may be null, or any string up to a large max length;
 * @param val the email template
 * @returns {boolean} True if valid
 */
module.exports.emailTemplateValidator = function(val) {


    if (!val) {
        return true;
    }
    if (typeof (val) !== 'string') {
        return false;
    }
    return val.length < MAX_TEMPLATE_LENGTH;
};

/**
 * Validate an email subject value. It may be null, or any string up to a large max length;
 * @param val the email template
 * @returns {boolean} True if valid
 */
subjectValidator = function(val) {

    if (!val) {
        return true;
    }
    if (typeof (val) !== 'string') {
        return false;
    }
    return (val.length <  MAX_SUBJECT_LENGTH);
};
module.exports.subjectValidator = subjectValidator;

/**
 * permission operations validator. An undefined value is allowed
 */
var permissionOpValidator = function (val) {
    if (!val) {
        return true;
    }
    if (typeof(val) !=='string') {
        return false;
    }
    if (val.length < 2 || val.length > PermissionOpMaxLength) {
        return false;
    }
    return permissionOpRegex.test(val);
};
exports.permissionOpValidator = permissionOpValidator;

/**
 * Provide a validator for resource permissions. Of the form
 * config.service.defaultPermissionsMetadata = {
    owner: 'unchanged',
    rights: {
        owner: ["r", "u", "d", "x", "pr", "pu"],
        realm: ["r", "u", "x"],
        roles: {
            demoAdmin: ['r', 'u', 'd', 'x', 'pu']
        }
    }
};

 * @param val
 * @returns {*}
 */
var resourcePermissionsValidator  = function(val) {
    if (!val) {
        return true;
    }
    if (typeof (val) != 'object') {
        return false;
    }
    if (!val.owner || typeof(val.owner) != 'string') {
        return false;
    }
    if (!val.rights || typeof(val.rights) != 'object') {
        return false;
    }


    return true;

};
module.exports.resourcePermissionsValidator = resourcePermissionsValidator;

var validateRightsJSON = function(val) {
    var logger = require('./loggers').getLogger();
    if (!val) {
        return new errors.BadRequestError('incorrectMetadataStructure');
    }
    if (val.length > MaxRightsLength) {
        return new errors.BadRequestDetailsError('invalidPermissionsFormat',
            'Rights string too long');
    }

    var ownerRights = val.owner;
    // Check that all owner rights are in the list of available rights
    if (ownerRights) {
        if (!ownerRights instanceof Array) {
            logger.error('Owner rights value is not array');
            return new errors.BadRequestError('incorrectMetadataStructure');
        }
        for (var i = 0; i < ownerRights.length; i++) {
            if (typeof ownerRights[i] !== 'string') {
                logger.error('Owner rights not instance of string: ' + typeof(ownerRights[i]));
                return new errors.BadRequestError('incorrectMetadataStructure');
            }
            if (!allowableRightsRegex.test(ownerRights[i])) {
                logger.error('Regex failure, owner rights: ' + ownerRights[i]);
                return new errors.BadRequestError('invalidPermissionsFormat');
            }
        }
    }

    // Check that all realm rights are in the list of available rights
    var realmRights = val.realm;
    if (realmRights) {
        if (!realmRights instanceof Array) {
            logger.error('Realm rights value is not array');
            return new errors.BadRequestError('incorrectMetadataStructure');
        }
        // Check that all owner rights are in the list of available rights
        for (var i = 0; i < realmRights.length; i++) {
            if (typeof realmRights[i] !== 'string') {
                logger.error('Realm rights not instance of string: ' + typeof(realmRights[i] ));
                return new errors.BadRequestError('incorrectMetadataStructure');
            }
            if (!allowableRightsRegex.test(realmRights[i])) {
                logger.error('Regex failure, realm rights: ' + realmRights[i]);
                return new errors.BadRequestError('invalidPermissionsFormat');
            }
        }
    }
    // For each role in roles object,
    // ensure rights are in the list of available rights

    for (var v in val.roles) {
        if (!rolenameValidator(v) ) {
            return new errors.BadRequestError('invalidRolename');
        }

        var roleRights  = val.roles[v];
        if (roleRights) {
            if (!roleRights instanceof Array) {
                logger.error('Role rights value is not array');
                return new errors.BadRequestError('incorrectMetadataStructure');
            }
            for (var i = 0; i < roleRights.length; i++) {
                if (typeof roleRights[i] !== 'string' ) {
                    logger.error('Role rights not instance of string: ' + typeof(roleRights[i]));
                    return new errors.BadRequestError('incorrectMetadataStructure');
                }
                if (!allowableRightsRegex.test(roleRights[i])) {
                    logger.error('Regex failure, role rights: ' + roleRights[i]);
                    return new errors.BadRequestError('invalidPermissionsFormat');
                }
            }
        }
    }
    return null;
};
exports.validateRightsJSON = validateRightsJSON;

var validateClientMetadataJSON = function(val) {

    if (val.length > MaxRightsLength) {
        return new errors.BadRequestDetailsError('invalidPermissionsFormat',
            'Rights string too long');
    }

    // Just make sure the client metadata is parseable. There's no structure to this
    try {
        JSON.parse(val);
        return null;
    } catch (e) {
        return e;
    }
};
exports.validateClientMetadataJSON = validateClientMetadataJSON;


