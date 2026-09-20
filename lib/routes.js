'use strict';

const {resolveRouteUrl} = require('./env');

/**
 * Lando proxy middlewares mirroring the headers Upsun's router adds.
 *
 * @param {string} originalRoute The resolved local URL.
 * @param {boolean} secure Whether the original route was https.
 * @returns {object[]} Lando proxy middleware entries.
 */
const getMiddlewares = (originalRoute, secure) => {
  const middlewares = [
    {name: 'upsun-ip', key: 'headers.customrequestheaders.X-Client-IP', value: 'host.docker.internal'},
    {name: 'upsun-route', key: 'headers.customrequestheaders.X-Original-Route', value: originalRoute},
  ];
  if (secure) {
    middlewares.push({name: 'upsun-ssl', key: 'headers.customrequestheaders.X-Client-SSL', value: 'on'});
  }
  return middlewares;
};

// Follow redirect routes until we land on an upstream route
const resolveUpstream = (route, routes, seen = new Set()) => {
  if (route.type === 'upstream') return route;
  if (route.type !== 'redirect' || !route.to || seen.has(route.to)) return null;
  seen.add(route.to);
  const target = routes[route.to];
  return target ? resolveUpstream(target, routes, seen) : null;
};

/**
 * Translate model routes into a Lando `proxy:` block.
 *
 * @param {object} model Normalized Upsun model.
 * @param {string} domain Lando proxy domain, eg `lndo.site`.
 * @param {object} targets Map of model app name to `{service, port}` describing which Lando service
 *   (and port) serves that app, eg `{app: {service: 'app_nginx', port: 80}}`.
 * @returns {{proxy: object, warnings: object[]}} Proxy config keyed by Lando service plus warnings.
 */
exports.getProxyConfig = (model, domain, targets = {}) => {
  const proxy = {};
  const warnings = [];
  for (const [url, route] of Object.entries(model.routes || {})) {
    const upstream = resolveUpstream(route, model.routes);
    if (!upstream || !upstream.upstream) continue;
    const appName = upstream.upstream.split(':')[0];
    const target = targets[appName];
    if (!target) continue;
    if (route.type === 'redirect') {
      warnings.push({
        code: 'redirect-route',
        message: `Route ${url} is a redirect to ${route.to}; Lando serves it directly from ${appName} instead.`,
        data: {route: url, to: route.to},
      });
    }
    const resolved = resolveRouteUrl(url, appName, domain);
    const parsed = new URL(resolved);
    const entry = {
      hostname: parsed.hostname,
      port: String(target.port),
      pathname: parsed.pathname || '/',
      middlewares: getMiddlewares(resolved, parsed.protocol === 'https:'),
    };
    proxy[target.service] = proxy[target.service] || [];
    const duplicate = proxy[target.service].some(existing => existing.hostname === entry.hostname &&
      existing.pathname === entry.pathname);
    if (!duplicate) proxy[target.service].push(entry);
  }
  return {proxy, warnings};
};
