## BridgeIt Common Module

### Description

The bridgeit-common module is a Node.js module used for common code required by various BridgeIt Services.  There are multiple components in the module for logging, validation, etc.

### Usage

To use bridgeit-common, you should add it as a requirement your package.json file:

    "dependencies": {
    ...
    "bridgeit-common": "latest",
    ...


Once the dependency has been set, you can use require to access it from your code:

    var bridgeit = require('bridgeit-common');

then you can get at whichever particular set of utilities you require.  For example:

    var logger = bridgeit.loggers.getLogger();
    var errors = bridgeit.errors;
    var btools = bridgeit.tools;
    var authCall = bridgeit.authCall;

