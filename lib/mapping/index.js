'use strict';

const {mapRuntime} = require('./runtimes');
const {mapModelService} = require('./services');

/**
 * Maps one normalized Upsun application to Lando service definitions.
 *
 * @param {object} app Normalized model application.
 * @param {object} model Complete normalized model.
 * @param {object} opts Mapping options.
 * @returns {{services: object, warnings: object[]}}
 */
const mapApplication = (app, model, opts = {}) => mapRuntime(app, opts);

/**
 * Maps one normalized Upsun service and its connection metadata.
 *
 * @param {object} service Normalized model service.
 * @param {object} model Complete normalized model.
 * @param {object} opts Mapping options.
 * @returns {{services: object, volumes?: object, hostMap: object, warnings: object[]}}
 */
const mapService = (service, model, opts = {}) => mapModelService(service, model, opts);

exports.mapApplication = mapApplication;
exports.mapService = mapService;
