'use strict';

const {mapRuntime} = require('./runtimes');
const {mapModelService} = require('./services');

/**
 * Maps one normalized Upsun application to Lando service definitions.
 *
 * @param {import('../config/config.types').UpsunApplication} app Normalized model application.
 * @param {import('../config/config.types').UpsunModel} _model Complete normalized model.
 * @param {import('./mapping.types').MappingOptions} opts Mapping options.
 * @returns {import('./mapping.types').MapResult}
 */
const mapApplication = (app, _model, opts = {}) => mapRuntime(app, opts);

exports.mapApplication = mapApplication;
exports.mapService = mapModelService;
