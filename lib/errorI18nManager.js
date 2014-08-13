var btools = require('./tools');

// Load the English resource file by default
var resourceBundles = {
   en: require('./res/en-messages.js')
};

function getMessage(req, err) {

    if (err.message && err.message.indexOf('undefined') == 0) {
        console.log('--> ' + err.stack);
    }

    var locale = btools.getLocale(req);
    var bundle = resourceBundles[locale];

    if (!bundle) {
        bundle = require('./res/' + locale + '-messages');
        if (bundle) {
            resourceBundles[locale] = bundle;
        }
    }
    if (!bundle) {
        bundle = resourceBundles['en'];
    }

    var mess;
    if (err.message) {
        // check for the presence of JS errors, and just leave them as is
        var messArray = err.message.split(' ');
        if (messArray.length > 1) {
            console.log(err.stack);
        } else {
            mess = bundle.messages[err.message];
        }
    }

    console.log('message: ' + err.message + ' = ' + mess);
    if (!mess) {
        console.log('SEVERE: NO message for: ' + err.message);
    }

    return mess;
};
module.exports.getMessage = getMessage;