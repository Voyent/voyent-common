## License

ICESOFT COMMERCIAL SOURCE CODE LICENSE V 1.1

The contents of this file are subject to the ICEsoft Commercial Source
Code License Agreement V1.1 (the "License"); you may not use this file
except in compliance with the License. You may obtain a copy of the
License at
http://www.icesoft.com/license/commercial-source-v1.1.html

Software distributed under the License is distributed on an "AS IS"
basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the
License for the specific language governing rights and limitations under
the License.

Copyright 2009-2014 ICEsoft Technologies Canada, Corp. All Rights Reserved.


### Starter Service Overview

The Starter Service is a small example Node service that illustrates how to use various aspects of Node.  It can be used as a tutorial or a quick starting point for another service.  It exposes a simple CRUD style API for storing messages in a database.


### Getting Started

Most of these instructions apply to any of our services. To get up and running you need to:

- Install NodeJS
- Install MongoDB

#### Installing Node (http://nodejs.org/)

Installers for Node are here:

[http://nodejs.org/download/](http://)

Once installed, you should be able to type:

    > node

Which puts you into a JavaScript shell.  This interpreter can be used for testing/evaluating code:

    > var name = 'nodejunkie';
    undefined
    > name
    'nodejunkie'`

#### Installing and Starting MongoDB (http://www.mongodb.org/)

Almost all of our services require MongoDB for storing data.  You can download a copy from here:

[http://www.mongodb.org/downloads](http://)
[http://docs.mongodb.org/manual/installation/](http://)

Start it in "default" mode which listens on a default port and should currently work for most of our services.  To start a database instance, switch to the bin directory:

    > cd ..../mongodb-osx-x86_64-2.4.3/bin

of the installation directory and run:

    > mongod 

    mongod --help for help and startup options
    Wed Feb 26 10:29:18.018 [initandlisten] MongoDB starting : pid=2145 port=27017 dbpath=/data/db/ 64-bit host=watnotte-pro.local
    Wed Feb 26 10:29:18.018 [initandlisten] db version v2.4.3
    Wed Feb 26 10:29:18.018 [initandlisten] git version: fe1743177a5ea03e91e0052fb5e2cb2945f6d95f
    Wed Feb 26 10:29:18.018 [initandlisten] build info: Darwin bs-osx-106-x86-64-1.local 10.8.0 Darwin Kernel Version 10.8.0: Tue Jun  7 16:33:36 PDT 2011; root:xnu-1504.15.3~1/RELEASE_I386 i386 BOOST_LIB_VERSION=1_49
    Wed Feb 26 10:29:18.018 [initandlisten] allocator: system
    Wed Feb 26 10:29:18.018 [initandlisten] options: {}
    Wed Feb 26 10:29:18.020 [initandlisten] journal dir=/data/db/journal
    Wed Feb 26 10:29:18.020 [initandlisten] recover : no journal files present, no recovery needed
    Wed Feb 26 10:29:18.086 [websvr] admin web console waiting for connections on port 28017
    Wed Feb 26 10:29:18.086 [initandlisten] waiting for connections on port 27017`


#### Installing Service Dependencies

To run any of our services, first checkout the icenotify project from:

    > svn co http://dev.icesoft.com/svn/repo/icenotify/trunk/icenotify

To run a specific service, switch to the service directory:
 
    > cd starter-service-node

Before running, we need to get the required modules that the service depends on.  These dependencies are documented in the package.json file and are stored under the node_modules directory of the service.  When you first check out a service, the node_modules are not present.  You use the `npm` tool included with Node to manage these dependencies.  The first step is to install them.

**Note:** The vast majority of these modules are available on the web and will get downloaded automatically.  The one exception is the bridgeit-common module.  This module contains code common to our services and is stored in our svn repository under the same icenotify directory as our other services.  To install just provide the location of the module on your filesystem.  Normally this will be a sibling directory to the service:

    > npm install ../bridgeit-common

To get the rest of the modules from the web, just type:

    > npm install

You'll see a long list of HTTP GETs while it downloads what is needed:

    npm http GET https://registry.npmjs.org/restify
    npm http GET https://registry.npmjs.org/winston
    ...
    [GETs all the modules needed for the service.]

If you check starter-service-node/node_modules directory, you should see a directory for each dependent module.

#### Running Starter Service

Run the service using node by passing in the "main" starting script file for that service:

    > node start.js

If successful, you should see something like the following:

	2014-03-10T19:05:13.428Z - info: BridgeIt Starter Service starting ...
	connecting to MongoDB @ mongodb://localhost/starter
	2014-03-10T19:05:13.606Z - info: [ messages.js@64 | exports.configure ]  registered REST API for /starter
	2014-03-10T19:05:13.609Z - info: BridgeIt Starter Service started
	2014-03-10T19:05:13.609Z - info: BridgeIt Starter Service listening at 55500



#### Testing

You can use `mocha` to run the unit tests on the service.  The test files are located under /test.  To run them you just navigate to the service directory and type:

    > mocha
    
The node console should show some logging and the console window you ran mocha from should show:

	
	  ․․․․․․․․
	
	  8 passing (73ms)

You can modify how mocha reports the results as well as which tests to run fairly easily.  For example, to change the reporter (-R) and only run the tests that do a POST:

    > mocha -R spec -g POST
    
      Messages
    POST new resource
      ✓ returns 200 
    POST existing resource
      ✓ returns 404 


    2 passing (34ms)

