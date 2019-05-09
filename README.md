## Voyent Common Module - VRAS-864

### Description

The voyent-common module is a Node.js module used for common code required by various Voyent Services.  There are multiple components in the module for logging, validation, etc.

### Usage

To use voyent-common, you should add it as a requirement your package.json file:

    "dependencies": {
    ...
    "voyent-common": "latest",
    ...


Once the dependency has been set, you can use require to access it from your code:

    var vc = require('voyent-common');

then you can get at whichever particular set of utilities you require.  For example:

    var logger = vc.loggers.getLogger();
    var errors = vc.errors;
    var btools = vc.tools;
    var authCall = vc.authCall;

