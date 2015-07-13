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
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.createResource = createResource;


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
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        if (!results || results.length === 0) {

            if (barrel.searchQuery && barrel.searchQuery._id) {
                cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
                return;
            }
        }
        console.log('findOne results', results);

        barrel.results = !results ? {} : results;
        cb(null, barrel);
    });
}
module.exports.getResource = getResource;

function getEmbeddedResource(barrel, cb) {

    getResource(barrel, function (err, barrel) {

        if (err) {
            cb(err);
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
            cb(new errors.ServerDetailsError('databaseError', err));
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


function updateResource(barrel, cb) {

    var logger = require('./loggers').getLogger();

    logger.debug('updating', barrel.searchQuery, barrel.validatedResource);

    barrel.collection.update(barrel.searchQuery, barrel.validatedResource, {w: 1}, function (err, doc) {

        if (err) {
            logger.error('could not update resource', err);
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        barrel.results = doc;
        cb(null, barrel);
    });
}
module.exports.updateResource = updateResource;


function updateEmbeddedResource(barrel, cb) {
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = barrel.validatedResource;
    barrel.validatedResource = {$set: embeddedResource};
    updateResource(barrel, cb);
}
module.exports.updateEmbeddedResource = updateEmbeddedResource;


function updateEmbeddedResourceArray(barrel, cb) {
    barrel.validatedResource = {$push: {mail: barrel.validatedResource} };
    updateResource(barrel, cb);
}
module.exports.updateEmbeddedResourceArray = updateEmbeddedResourceArray;


function deleteResource(barrel, cb) {

    var logger = require('./loggers').getLogger();
    logger.debug('deleting resource');

    barrel.collection.remove(barrel.searchQuery, {w: 1}, function (err, numberOfDocs) {

        if (err) {
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        //Complain since we are trying to delete a specific resource.
        if (numberOfDocs === 0) {
            cb(new errors.NotFoundDetailsError('resourceNotFound', JSON.stringify(barrel.searchQuery)));
            return;
        }

        barrel.results = numberOfDocs;
        cb(null, barrel);
    });

}
module.exports.deleteResource = deleteResource;


function deleteEmbeddedResource(barrel, cb) {
    var embeddedResource = {};
    embeddedResource[barrel.resourceType] = {};
    barrel.validatedResource = {$set: embeddedResource};
    updateResource(barrel, cb);
}
module.exports.deleteEmbeddedResource = deleteEmbeddedResource;


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

    barrel.collection.remove(barrel.searchQuery, {w: 1}, function (err, numberOfDocs) {

        if (err) {
            cb(new errors.ServerDetailsError('databaseError', err));
            return;
        }

        barrel.results = numberOfDocs;
        cb(null, barrel);
    });
}
module.exports.deleteResources = deleteResources;


function determineResourceURL(barrel, cb) {

    var logger = require('./loggers').getLogger();
    barrel.resourceURL = crud.calculateResourceURL(
        barrel.req.protocol,
        config.service.host,
        config.service.port,
        barrel.req.path,
        barrel.validatedResourceId);
    logger.debug('resource URL: ' + barrel.resourceURL);
    cb(null, barrel);

}
module.exports.determineResourceURL = determineResourceURL;


