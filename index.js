exports.config = require('./lib/config');

//The logger is deprecated, use loggers instead
exports.logger = require('./lib/logger');
exports.loggers = require('./lib/loggers');

exports.tools = require('./lib/tools');
exports.security = require('./lib/security');
exports.errorHandlers = require('./lib/errorHandlers');
exports.errors = require('./lib/errors');
exports.authCall = require('./lib/authCall');
exports.metrics = require('./lib/metrics');
exports.validation = require('./lib/validation');
exports.db = require('./lib/db');
exports.crud = require('./lib/crud');