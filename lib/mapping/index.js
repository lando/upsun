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

/**
 * Maps one normalized Upsun service and its connection metadata.
 *
 * @param {import('../config/config.types').UpsunService} service Normalized model service.
 * @param {import('../config/config.types').UpsunModel} model Complete normalized model.
 * @param {import('./mapping.types').MappingOptions} opts Mapping options.
 * @returns {import('./mapping.types').ServiceMapResult}
 */
const mapService = (service, model, opts = {}) => mapModelService(service, model, opts);

exports.mapApplication = mapApplication;
exports.mapService = mapService;
