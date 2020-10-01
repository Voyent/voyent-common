var config = require('./config');
var errors = require('./errors');
var crud = require('./crud');

/**
 * @deprecate using createStructuredResource instead
 */
function createResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    if (barrel.validatedResourceId) {
        barrel.validatedResource._id = barrel.validatedResourceId;
    }

    logger.debug('creating resource: ' +
        '\n  ' + JSON.stringify(barrel.validatedResource)
    );

    barrel.collection.insertOne(barrel.validatedResource, {w: 1}, function (err, doc) {

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

    var newRecord  = barrel.validatedResource;
    // The ownername can come from the parsed record, or be the username by default
    delete newRecord._id;
    barrel.collection.insertOne(newRecord, {w: 1}, function (err, doc) {

        if (err) {
            logger.error('could not create resource: ' + JSON.stringify(err), barrel.meta);
            return cb(err, barrel);
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.createStructuredResource = createStructuredResource;

/**
 * @deprecate use getStructuredResource instead
 */
function getResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('getting resource with: ' +
        '\n  query   = ' + JSON.stringify(barrel.searchQuery) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    let options = barrel.queryOptions ? barrel.queryOptions : {};
    if (barrel.fieldsFilter) {
        options.projection = barrel.fieldsFilter;
    }
    barrel.collection.findOne(barrel.searchQuery, options, function (err, results) {

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

/**
 * Get the contents of a record into barrel.results
 */
function getStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('getting resource with: ' +
        '\n  query   = ' + JSON.stringify(barrel.query) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    let options = barrel.queryOptions ? barrel.queryOptions : {};
    if (barrel.fieldsFilter) {
        options.projection = barrel.fieldsFilter;
    }
    barrel.collection.findOne(barrel.query, options, function (err, result) {
        if (err) {
            return cb(err, barrel);
        }

        if (!result) {
            if (barrel.query && barrel.searchQuery._id) {
                cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.query)), barrel);
                return;
            }
        }
        logger.debug('findOne result: ' + result);
        barrel.results = result;
        cb(null, barrel);
    });
}
module.exports.getStructuredResource = getStructuredResource;


/**
 * Retrieve an embedded portion of a record from a a structured resource environment
 * the subdocument key should be stored in barrel.resourceType
 */
function getEmbeddedResource(barrel, cb) {
    getStructuredResource(barrel, function (err, barrel) {

        if (err) {
            cb(err, barrel);
            return;
        }
        barrel.results = barrel.results[barrel.resourceType];
        cb(null, barrel);
    });
}
module.exports.getEmbeddedResource = getEmbeddedResource;


/**
 * @deprecate use getStructuredResources instead
 */
function getResources(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('getting resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.searchQuery) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );

    barrel.collection.find(barrel.searchQuery, barrel.queryOptions).project(barrel.fieldsFilter).toArray(function (err, results) {

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

/**
 * Used to read multiple structured resources. The client does not see or need to know the underlying
 * Mongo structure of the document
 */
function getStructuredResources(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('getting resources with: ' +
        '\n  query   = ' + JSON.stringify(barrel.query) +
        '\n  fields  = ' + JSON.stringify(barrel.fieldsFilter) +
        '\n  options = ' + JSON.stringify(barrel.queryOptions) +
        '\n  results = ' + barrel.resultsScope
    );


    barrel.collection.find(barrel.query, barrel.queryOptions).project(barrel.fieldsFilter).toArray(function (err, results) {

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

        if (results) {
            var newResults = [];
            for (var v = 0; v < results.length; v++) {
                var rc = results[v];
                newResults.push(rc);
            }
        }
        barrel.results = !newResults ? {} : newResults;
        cb(null, barrel);
    });
}
module.exports.getStructuredResources = getStructuredResources;

/**
 * @deprecate use updateStructuredResource instead.
 */
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

/**
 * Used to update a document (or portion thereof) in the resource permissions environment.
 * This function handles inserting the client data into the appropriate pattern
 */
function updateStructuredResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('updating resource, query: ', barrel.query, '\n record: ' + barrel.validatedResource);
    delete barrel.validatedResource._id;

    var updateObject = {};

    if (barrel.subDocumentFlag) {
        updateObject[barrel.resourceType] = barrel.validatedResource[barrel.resourceType]; // the value of the subdoc part only
    } else {
        updateObject = barrel.validatedResource; // The whole object
    }
    // Obviously, if we're doing updateOne, we'd expect one or zero, but we need to determine how many
    // records we can see without the permissions clauses (which is given by barrel.countQuery)
    //barrel.collection.countDocuments(barrel.countQuery, {}, function (err, count) {
    //    if (err) {
    //        logger.error('Exception performing count query: ' + JSON.stringify(err), barrel.meta);
    //        return cb(err, barrel);
    //    }
    //    logger.debug('Potential record update count: ' + count);
    //    if (count === 0) {
    //        return cb(new errors.NotFoundError('resourceNotFound'), barrel);
    //    }
    //    possibleRecordCount = count;
        barrel.collection.updateOne(barrel.query,
            {
                $set: updateObject
            }, barrel.queryOptions, function (err, doc) {

                if (err) {
                    logger.error('could not update resource: ' + JSON.stringify(err), barrel.meta);
                    cb(err, barrel);
                    return;
                }

                logger.debug('xxUpdateStructuredResource: docs scanned: ' + doc.result.n + ', docs modified: ' +
                            doc.result.nModified);


                // we don't care if the nModified is 1. It can be zero if the document hasn't changed
                barrel.results = doc.result.nModified;
                cb(null, barrel);
            });
}
module.exports.updateStructuredResource = updateStructuredResource;


/**
 * Inserts a record into a subdocument Array in the resource permission scheme.
 */
function incrementStructuredResourceArray(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('updating', barrel.query, barrel.validatedResource);
    delete barrel.validatedResource._id;

    var updateObject = {};
    updateObject[barrel.resourceType] = barrel.validatedResource; // the validated resource is the update


    barrel.collection.updateOne(barrel.query,
        {
            $push: updateObject
        }, barrel.queryOptions, function (err, doc) {

            if (err) {
                logger.error('could not increment resource array: ' + JSON.stringify(err), barrel.meta);
                cb(err, barrel);
                return;
            }

            logger.debug('xxIncrementResourceArray: docs scanned: ' + doc.result.n + ', docs modified: ' +
            doc.result.nModified);
            barrel.results = doc.result.nModified;
            cb(null, barrel);
        });
}
module.exports.incrementStructuredResourceArray = incrementStructuredResourceArray;


/**
 * @deprecate use updateStructuredSubResource instead
 */
function updateEmbeddedResource(barrel, cb) {
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = barrel.validatedResource;
    barrel.validatedResource = {$set: embeddedResource};
    updateResource(barrel, cb);
}
module.exports.updateEmbeddedResource = updateEmbeddedResource;

function updateEmbeddedStructuredResource(barrel, cb) {
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = barrel.validatedResource;
    barrel.validatedResource = embeddedResource;
    barrel.subDocumentFlag = true;
    updateStructuredResource(barrel, cb);
}
module.exports.updateEmbeddedStructuredResource = updateEmbeddedStructuredResource;



/**
 * @deprecate use updatedEmbeddedStructuredResourceArray instead
 */
function updateEmbeddedResourceArray(barrel, cb) {
    var updatedResource = {};
    updatedResource[barrel.resourceType] = barrel.validatedResource;
    barrel.subDocumentFlag = true;
    updateResource(barrel, cb);
}
module.exports.updateEmbeddedResourceArray = updateEmbeddedResourceArray;



/**
 * todo: incorporate with resource permissions
 */
function updateEmbeddedResourceSubdocumentArray(barrel, cb) {
    var updatedResource = {};
    updatedResource[barrel.resourceType] = barrel.validatedResource;
    barrel.subDocumentFlag = true;
    updateStructuredResource(barrel, cb);
}
module.exports.updateEmbeddedResourceSubdocumentArray = updateEmbeddedResourceSubdocumentArray;



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
    var deletedResource = {};
    deletedResource[barrel.resourceType] = {};
    barrel.validatedResource = deletedResource;
    barrel.subDocumentFlag = true;
    updateStructuredResource(barrel, cb);
}
module.exports.deleteEmbeddedResource = deleteEmbeddedResource;

/**
 * Function to empty an array which is a subdocument
 */
function deleteEmbeddedResourceArray(barrel, cb) {
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = [];
    barrel.validatedResource = embeddedResource;
    barrel.subDocumentFlag = true;
    updateStructuredResource(barrel, cb);
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


