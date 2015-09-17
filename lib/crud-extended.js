var config = require('./config');
var errors = require('./errors');
var crud = require('./crud');


function createResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (barrel.validatedResourceId) {
        barrel.validatedResource._id = barrel.validatedResourceId;
    }

    logger.debug('creating resource: ' +
        '\n  ' + JSON.stringify(barrel.validatedResource)
    );

    barrel.collection.insert(barrel.validatedResource, {w: 1}, function (err, doc) {

        if (err) {
            logger.error('could not create resource', err);
            cb(err, barrel);
            return;
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.createResource = createResource;

function createStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (barrel.validatedResourceId) {
        barrel.validatedResource._id = barrel.validatedResourceId;
    }

    logger.debug('creating resource: ' +
        '\n  ' + JSON.stringify(barrel.validatedResource)
    );

    var newRecord  = {
        _id: barrel.validatedResource._id,
        _data : barrel.validatedResource,
        _permissions: barrel.resourceMetadata
    };
    // The ownername can come from the parsed record, or be the username by default
    if (barrel.parsedOwner) {
        newRecord._permissions.owner = barrel.parsedOwner;
    } else {
        newRecord._permissions.owner = barrel.username;
    }
    delete newRecord._data._id;
    barrel.collection.insert(newRecord, {w: 1}, function (err, doc) {

        if (err) {
            logger.error('could not create resource: ' + JSON.stringify(err), barrel.meta);
            return cb(err, barrel);
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.createStructuredResource = createStructuredResource;


function getResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('getting resource with: ' +
        '\n  query   = ' + JSON.stringify(barrel.searchQuery) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.findOne(barrel.searchQuery, barrel.fieldsFilter, barrel.queryOptions, function (err, results) {

        if (err) {
            return cb(err, barrel);
        }

        if (!results || results.length === 0) {

            if (barrel.searchQuery && barrel.searchQuery._id) {
                cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
                return;
            }
        }
        barrel.results = !results ? {} : results;
        cb(null, barrel);
    });
}
module.exports.getResource = getResource;

function getStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('getting resource with: ' +
        '\n  query   = ' + JSON.stringify(barrel.query) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.findOne(barrel.query, barrel.fieldsFilter, barrel.queryOptions, function (err, result) {

        if (err) {
            return cb(err, barrel);
        }

        if (!result) {
            if (barrel.query && barrel.query._id) {
                cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.query)), barrel);
                return;
            }
        }
        logger.debug('findOne result: ' + result);
        var newRecord = result._data;
        newRecord['_id'] = result._id;
        barrel.results = newRecord;
        cb(null, barrel);
    });
}
module.exports.getStructuredResource = getStructuredResource;


function getEmbeddedResource(barrel, cb) {

    getResource(barrel, function (err, barrel) {

        if (err) {
            cb(err, barrel);
            return;
        }
        barrel.results = barrel.results[barrel.resourceType];
        cb(null, barrel);
    });
}
module.exports.getEmbeddedResource = getEmbeddedResource;


function getResources(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('getting resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.searchQuery) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.find(barrel.searchQuery, barrel.fieldsFilter, barrel.queryOptions).toArray(function (err, results) {

        if (err) {
            cb(err, barrel);
            return;
        }

        if (!results || results.length === 0) {

            if (barrel.searchQuery && barrel.searchQuery._id) {
                cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
                return;
            }
        }

        barrel.results = !results ? {} : results;
        cb(null, barrel);
    });
}
module.exports.getResources = getResources;

function getStructuredResources(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('getting resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.query) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.find(barrel.query, barrel.fieldsFilter, barrel.queryOptions).toArray(function (err, results) {

        if (err) {
            cb(err, barrel);
            return;
        }

        if (!results || results.length === 0) {
            if (barrel.query && barrel.query._id) {
                cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.query)), barrel);
                return;
            }
        }

        barrel.results = !results ? {} : results;
        cb(null, barrel);
    });
}
module.exports.getStructuredResources = getStructuredResources;

function updateResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('updating', barrel.searchQuery, barrel.validatedResource);
    barrel.collection.update(barrel.searchQuery, barrel.validatedResource, {w: 1}, function (err, doc) {

        if (err) {
            logger.error('could not update resource', err);
            cb(err, barrel);
            return;
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.updateResource = updateResource;

function updateStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('updating', barrel.query, barrel.validatedResource);
    delete barrel.validatedResource._id;

    // All client information is stored in the _data partition. Setting a further namespace string
    // will allow us to be more specific with the update
    var setClause = "_data";
    var possibleRecordCount = 0;
    // Obviously, if we're doing updateOne, we'd expect one or zero, but we need to determine how many
    // records we can see without the permissions clauses (which is given by barrel.countQuery)
    barrel.collection.count(barrel.countQuery, function (err, count) {
        if (err) {
            logger.error('Exception performing count query: ' + JSON.stringify(err), barrel.meta);
            return cb(err, barrel);
        }
        logger.debug('Potential record update count: ' + count);
        if (count === 0) {
            return cb(new errors.NotFoundError('resourceNotFound'), barrel);
        }
        possibleRecordCount = count;
        barrel.collection.updateOne(barrel.query,
            {
                $set: {"_data": barrel.validatedResource} // This replaces the whole _data partition. We'll need something
            }, barrel.queryOptions, function (err, doc) {

                if (err) {
                    logger.error('could not update resource: ' + JSON.stringify(err), barrel.meta);
                    cb(err, barrel);
                    return;
                }

                logger.debug('__ matched count: ' + doc.matchedCount + ', scanned: ' + doc.result.n + ', modified: ' +
                            doc.result.nModified);
                if (possibleRecordCount != doc.result.nModified) {
                    return cb(new errors.PermissionError('permissionNotGranted'), barrel);
                }

                barrel.results = doc.result.nModified;
                cb(null, barrel);
            });
    });
}
module.exports.updateStructuredResource = updateStructuredResource;

// Todo: get an endpoint that can test this. This is not compatible with resource permissions as is
function updateEmbeddedResource(barrel, cb) {
    logger.warn('Deprecated! Use updateStructuredResource instead')
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = barrel.validatedResource;
    barrel.validatedResource = {$set: embeddedResource};
    updateResource(barrel, cb);
}
module.exports.updateEmbeddedResource = updateEmbeddedResource;

// Todo: get an endpoint that can test this. This is not compatible with resource permissions as is
function updateStructuredSubResource(barrel, cb) {
    var embeddedResource = {};
    embeddedResource['_data.' + barrel.resourceType] = barrel.validatedResource;
    barrel.validatedResource = {$set: embeddedResource};
    updateResource(barrel, cb);
}
module.exports.updateStructuredSubResource = updateStructuredSubResource;

// Todo: This is not resolved.
function updateEmbeddedResourceArray(barrel, cb) {
    barrel.validatedResource = {$push: {mail: barrel.validatedResource} };
    updateResource(barrel, cb);
}
module.exports.updateEmbeddedResourceArray = updateEmbeddedResourceArray;


function deleteResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('deleting resource');

    barrel.collection.remove(barrel.searchQuery, {w: 1}, function (err, writeOpResult) {

        if (err) {
            return cb(err, barrel);
        }

        //Complain since we are trying to delete a specific resource.
        if (writeOpResult.result.n === 0) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)), barrel);
            return;
        }

        barrel.results = writeOpResult.result.n;
        cb(null, barrel);
    });
}
module.exports.deleteResource = deleteResource;



function deleteStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.info('removing resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.query), barrel.meta
    );

    barrel.collection.remove(barrel.query, {w: 1}, function (err, writeOpResult) {

        if (err) {
            logger.error('Error removing structured resource: ' + JSON.stringify(err), barrel.meta);
            return cb(err, barrel);
        }

        logger.debug('removed ' + writeOpResult.result.n + ' structured resources');
        //Complain since we are trying to delete a specific resource.
        if (writeOpResult.result.n === 0) {
            return cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.query)), barrel);
        }

        barrel.results = writeOpResult.result.n;
        cb(null, barrel);
    });
}
module.exports.deleteStructuredResource = deleteStructuredResource;

// Todo: update this to fit with resource permissions
function deleteEmbeddedResource(barrel, cb) {
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = {};
    barrel.validatedResource = {$set: embeddedResource};
    updateResource(barrel, cb);
}
module.exports.deleteEmbeddedResource = deleteEmbeddedResource;

// Todo: update this to fit with resource permissions
function deleteEmbeddedResourceArray(barrel, cb) {
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = [];
    barrel.validatedResource = {$set: embeddedResource};
    updateResource(barrel, cb);
}
module.exports.deleteEmbeddedResourceArray = deleteEmbeddedResourceArray;


function deleteResources(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('deleting resources');

    barrel.collection.remove(barrel.searchQuery, {w: 1}, function (err, writeOpResult) {

        if (err) {
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        barrel.results = writeOpResult.result.n;
        cb(null, barrel);
    });
}
module.exports.deleteResources = deleteResources;

// Not sure if there's a need for the plural version of this vs a singular version.
function deleteStructuredResources(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('deleting resources');

    barrel.collection.remove(barrel.query, {w: 1}, function (err, writeOpResult) {
        if (err) {
            logger.error('Error removing resources: ' + JSON.stringify(err), barrel.meta);
            return cb(err, barrel);
        }

        barrel.results = writeOpResult.result.n;
        cb(null, barrel);
    });
}
module.exports.deleteStructuredResources = deleteStructuredResources;


function determineResourceURL(barrel, cb) {

    var logger = require('./loggers').getLogger();
    barrel.resourceURL = crud.calculateResourceURL(
        barrel.req.protocol,
        config.service.host,
        config.auth.port,
        barrel.req.path,
        barrel.validatedResourceId);
    logger.debug('resource URL: ' + barrel.resourceURL);
    cb(null, barrel);

}
module.exports.determineResourceURL = determineResourceURL;


