var us = require('underscore');
var expand = require('json-templater/object');

//parameterize query property on the barrel resource
function parameterizeQuery(barrel, cb) {
    var logger = require('./loggers').getLogger();
    logger.debug('parameterizing query:',JSON.stringify(barrel.validatedResource.query));

    var doParameterize = function (query) {
        us.each(query,function (value, key, list) {
            if (us.isObject(value)) {
                doParameterize(value);
            }
            var newKey = key;
            if (us.isString(key)) {
                newKey = newKey.replace(/\$/g,"{{dbOp}}").replace(/\./g,"{{dot}}");
            }
            if (us.isString(value)) {
                value = value.replace(/\$/g,"{{dbOp}}").replace(/\./g,"{{dot}}");
            }
            list[newKey] = value;
            if (key !== newKey) {
                delete list[key];
            }
        });
    };

    doParameterize(barrel.validatedResource.query);
    logger.debug('new query:',JSON.stringify(barrel.validatedResource.query));

    cb(null, barrel);
}
module.exports.parameterizeQuery = parameterizeQuery;

//unparameterize barrel results
function unParameterizeQuery(barrel, cb) {
    var logger = require('./loggers').getLogger();
    logger.debug('unparameterizing query:',JSON.stringify(barrel.results));

    var expansionValues = {
        dot: '.',
        dbOp: '$'
    };
    //since the user can add custom template values on the
    //query we need to check query params for these values
    expansionValues = us.extend(barrel.req.query,expansionValues);
    barrel.results = expand(barrel.results, expansionValues);

    logger.debug('new query:',JSON.stringify(barrel.results));
    cb(null, barrel);
}
module.exports.unParameterizeQuery = unParameterizeQuery;

//unparameterizes the passed query and returns it
function unParameterizeQuerySimple(query) {
    var logger = require('./loggers').getLogger();
    logger.debug('unparameterizing query:',JSON.stringify(query));

    var expansionValues = {
        dot: '.',
        dbOp: '$'
    };
    query = expand(query, expansionValues);

    logger.debug('new query:',JSON.stringify(query));
    return query;
}
module.exports.unParameterizeQuerySimple = unParameterizeQuerySimple;