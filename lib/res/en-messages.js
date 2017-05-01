var errConstantsEnglish = {

    // A general purpose Action service error
    generalError: 'An internal server error',

    invalidAccountname: 'Invalid Accountname Field',
    invalidDescription: 'Invalid Account description',
    invalidRealmReference: 'Referenced realm not contained in Account',
    invalidAdminConfiguration: 'Account is missing initial Administrator',
    invalidAdminFormat: 'Admin record structure is not valid',
    invalidRecordBody: 'A record has not been supplied in the request',

    //Basic problems with the request
    requestMissingAccount: 'A valid account is required.',
    requestMissingRealm: 'A valid realm is required.',
    requestMissingResource: 'A valid resource is required.',
    requestMissingAccessToken: 'A valid access_token is required.',
    requestMissingPermissions: 'A valid set of permissions is required.',
    requestMissingOrInvalidPayload: 'The request payload is missing or invalid.',
    requestBadParameter: 'The request has an invalid parameter.',
    rangeError: 'A range read request contains illegal parameters',

    // Admin/user validation errors
    invalidUsername: 'The username is invalid',
    invalidFirstname: 'The firstname is invalid',
    invalidLastname: 'The lastname is invalid',
    invalidPassword: 'The password is invalid',
    passwordMismatch: 'The password and password_confirm fields do not match',
    invalidEmail: 'The Email address is invalid',
    invalidPermissionsFormat: 'Format of the permissions array is incorrect',
    invalidRolesFormat: 'The Format of the roles array is incorrect',
    invalidUserDisabled: 'The Format of the disabled flag is not a boolean or string',
    invalidTSAEnable: 'The Format of the tsa_enable flag is neither boolean nor string',
    invalidRolename: 'The specified rolename is invalid',
    invalidRootURI: 'The validation root URI format is invalid or missing',
    invalidEmailTemplate: 'The validation email template contained illegal characters',
    invalidUnconfirmed: 'The user unconfirmed flag is not a boolean value',
    invalidExpiresIn: 'The confirmation expiresIn value is invalid or missing',
    invalidConfirmationSubject: 'The confirmation email subject is invalid',
    invalidCustomField: 'The custom field is not a valid JSON format',

    // Realm validation errors
    invalidRealmName: 'The realm name contains invalid characters',
    invalidRealmEnabled: 'The realm enabled field is not a boolean value',
    invalidRealmOrigins: 'The realm origins field is invalid',
    invalidRealmPermissions: 'The realm permissions format is invalid',
    invalidServicesArray: 'The service reference array format is invalid',
    invalidQuickUser: 'The quick_user field is not boolean format',
    invalidAdminAccess: 'The admin_access field is not boolean format',
    invalidTemplatePermission: 'The template user may not be granted voyent.auth permissions',
    quickUserDisabled: 'Anonymous user signup not enabled',
    quickUserNoTemplate: 'Anonymous user template record is not defined',
    quickUserPasswordRequired: 'The anonymous user record must contain a new password',
    quickUserPasswordConfirmRequired: 'The anonymous user record must contain a confirmation password',

    // Client Application validation errors
    invalidAppName: 'The application name format is invalid',
    invalidAppDescription: 'The application description is invalid',
    invalidAppCost: 'The application cost format is invalid',
    invalidAppPermissionFormat: 'The application permissions array format is invalid',
    invalidAppPermissionContent: 'The application permissions array may not contain "Voyent."',
    invalidContextFormat: 'The format of the context record is incorrect',

    invalidOriginFormat: 'The value of the origin field is invalid',

    // Various content validation errors. The format of the request is ok, but the content is invalid/illegal
    invalidUserAccess: 'The User identified by the access_token does not match that in the request',
    invalidAccountAccess: 'The Account identified by the access_token does not match that in the request',
    invalidRealmAccess: 'The Realm in the request is not administered by access_token',

    adminPermissionContentError: 'Administrators may not be granted service or app level permissions',
    ungrantablePermission: 'Voyent permission not in set linked to realm',
    duplicateResource: 'A record with the same key field already exists',
    realmAlreadyExists: 'A realm with that name already exists',
    adminAlreadyExists: 'An administrator with that name already exists',
    lastAdminError: 'Cannot delete last Admin from account',
    invalidRoleReference: 'Format of the role reference structure is invalid',
    invalidRoleStructure: 'Format of the role record is incorrect',


    // Various other errors
    accountNotFound: 'Account not found',
    realmNotFound: 'Realm not found',
    adminNotFound: 'Administrator not found',
    userNotFound: 'User not found',
    appNotFound: 'Application not found',
    realmNotOwned: 'Account does not contain realm',
    resourceNotFound: 'Could not find the requested resource.',
    blobNotFound: 'Blob not found',
    roleNotFound: 'Role not found',
    contextNotFound: 'Context not found',
    transactionNotFound: 'Transaction Code not found',


    // permission check errors
    missingAccount: 'The permission check is missing the Account Name',
    missingUsername: 'The permission directory check is missing the Username',
    missingRealm: 'The permission check is missing the realm',
    missingToken: 'The permission check is missing the access_token',
    missingPermissions: 'The permission check is missing the required permissions field',
    invalidStrategy: 'Unsupported Token/permission strategy',
    missingConfirmationId: 'The confirmation request is missing the confirmationId',

    // Database errors
    databaseError: 'Database error',

    // Permission errors
    notAuthenticated: 'Invalid credentials',
    invalidToken: 'The access_token is invalid or expired',
    permissionNotGranted: 'Permission(s) for the operation were not granted',

    // This is the root error, but the message can be overriden with context sensitive info
    mismatchedRecordArrayLength: 'Attempt to find services array with invalid service names',
    // Context aware errors
    invalidRealmPermissionRequest: 'Attempt to grant a realm a permission from a service which does not exist',
    invalidUserPermissionRequest: 'Attempt to grant a user a permission from a service which does not exist',
    invalidApplicationRemoval: 'Attempt to remove an Application which does not exist',
    invalidServiceRemoval: 'Attempt to remove a Service which does not exist',

    serviceRequestError: 'External request to another service was unsuccessful',
    unsupportedOperation: 'Unsupported static method call on Mongoose Schema',

    // Proxy errors
    missingServiceConfig: 'Proxy missing service config',
    incorrectMetadataStructure: 'Missing or incorrect metadata structure',
    invalidIterationCollection: 'Iteration collection missing or not an array',
    invalidConditionalClause: 'Conditional clause invalid'
};
module.exports.messages = errConstantsEnglish;