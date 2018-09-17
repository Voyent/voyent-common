//This library is used by all of our Node-based services
exports.config = require('./lib/config');
// exports.env = require('./lib/env');

//The logger is deprecated, use loggers instead
exports.logger = require('./lib/logger');
exports.loggers = require('./lib/loggers');

exports.tools = require('./lib/tools');
exports.security = require('./lib/security');
exports.errorHandlers = require('./lib/errorHandlers');
exports.errors = require('./lib/errors');
exports.authCall = require('./lib/authCall');
exports.metrics = require('./lib/metrics');
exports.events = require('./lib/event');
exports.validation = require('./lib/validation');
exports.db = require('./lib/db');
exports.crud = require('./lib/crud');
exports.crudx = require('./lib/crud-extended');
exports.events = require('./lib/events');
exports.query = require('./lib/query');
exports.scopes = require('./lib/scopes');
exports.lock = require('./lib/lock');
exports.runtimeEnvironment = require('./lib/runtimeEnvironment');
exports.awsCommon = require('./lib/aws-common');
exports.awsSQSClient = require('./lib/aws-sqs-client');
