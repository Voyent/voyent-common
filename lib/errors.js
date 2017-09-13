function PermissionError(message) {
    this.message = message;
    this.status=403;
//    this.stack = Error().stack;
}
PermissionError.prototype = Object.create(Error.prototype);
PermissionError.prototype.name = "PermissionError";

/**
 * A custom bridget Error class
 * @param status The error status code
 * @param message String representation of error
 */
function OperationError(status, message) {
    this.message = message;
    this.status = status;
}
OperationError.prototype = Object.create(Error.prototype);
OperationError.prototype.name = "OperationError";

exports.PermissionError = PermissionError;
exports.OperationError = OperationError;


function BadRequestError(message) {
    this.status = 400;
    this.message = message;
}
BadRequestError.prototype = Object.create(Error.prototype);
BadRequestError.prototype.name = "BadRequestError";
module.exports.BadRequestError = BadRequestError;

function BadRequestDetailsError(message, details) {
    this.status = 400;
    this.message = message;
    this.details = details;
}
BadRequestDetailsError.prototype = Object.create(Error.prototype);
BadRequestDetailsError.prototype.name = "BadRequestDetailsError";
module.exports.BadRequestDetailsError = BadRequestDetailsError;

function AuthorizationError(message) {
    this.status = 401;
    this.message = message;
}
AuthorizationError.prototype = Object.create(Error.prototype);
AuthorizationError.prototype.name = "AuthorizationError";
module.exports.AuthorizationError = AuthorizationError;

function AuthorizationErrorDetails(message, details) {
    this.status = 401;
    this.message = message;
    this.details = details;
}
AuthorizationErrorDetails.prototype = Object.create(Error.prototype);
AuthorizationErrorDetails.prototype.name = "AuthorizationErrorDetails";
module.exports.AuthorizationErrorDetails = AuthorizationErrorDetails;

function NotFoundError(message) {
    this.status = 404;
    this.message = message;
}
NotFoundError.prototype = Object.create(Error.prototype);
NotFoundError.prototype.name = "NotFoundError";
module.exports.NotFoundError = NotFoundError;

function NotFoundDetailsError(message, details) {
    this.status = 404;
    this.message = message;
    this.details = details;
}
NotFoundDetailsError.prototype = Object.create(Error.prototype);
NotFoundDetailsError.prototype.name = "NotFoundDetailsError";
module.exports.NotFoundDetailsError = NotFoundDetailsError;


function ServerError(message) {
    this.status = 500;
    this.message = message;
}
ServerError.prototype = Object.create(Error.prototype);
ServerError.prototype.name = "ServerError";
module.exports.ServerError =  ServerError;

function ServerDetailsError(message, details) {
    this.status = 500;
    this.message = message;
    this.details = details;
}
ServerDetailsError.prototype = Object.create(Error.prototype);
ServerDetailsError.prototype.name = "ServerDetailsError";
module.exports.ServerDetailsError =  ServerDetailsError;

