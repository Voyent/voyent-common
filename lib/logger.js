var config = require('./config');
var winston = require('winston');

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({ level: config.logging.consoleLevel, json: false, timestamp: true }),
        new winston.transports.File({ level: config.logging.fileLevel, filename: __dirname + '/debug.log', json: false, maxsize: 2000000 })
    ],
    exceptionHandlers: [
        new (winston.transports.Console)({ json: false, timestamp: true }),
        new winston.transports.File({ filename: __dirname + '/exceptions.log', json: false })
    ],
    exitOnError: false
});


/**
 * Returns the current method call with file and line number, useful for adding to logging statements.
 *
 * @param incCol
 * @returns {string}
 */
function stack(incCol) {

//    var tb = traceback();
//    var st = tb[1];
//    if (!st) {
//        st = tb[0];
//    }
//
//    var funcName = st.name;
//    if (!funcName) {
//        funcName = "anon";
//    }
//    var info = '[ ' + st.file + '@' + st.line + ' | ' + funcName;
//    if (incCol) {
//        info = info + st.col + ' ';
//    }
//    return info + ' ] ';

    return '[unknown]';
}

module.exports = logger;
module.exports.stack = stack;
