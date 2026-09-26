'use strict';

const {expandRouteUrls, getLocalHosts} = require('./domains');

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

// Matches the host with or without an explicit port (Lando may proxy on fallback ports)
const escapeHost = host => `${host.replace(/\./g, '\\.')}(?::\\d+)?`;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const withoutTrailingSlash = value => value.replace(/\/+$/, '');
const absoluteRedirect = (to, host) => to.startsWith('/') ? `https://${host}${to}` : to;
const replaceGroups = value => value.replace(/\$(\d+)/g, (_match, group) => `\${${group}}`);

// Lando writes middleware values into docker compose labels, where a bare `$` is interpolated
const escapeCompose = value => value.replace(/\$/g, '$$$$');

const getRedirectMiddlewares = (name, regex, replacement, permanent) => [
  {name, key: 'redirectregex.regex', value: escapeCompose(regex)},
  {name, key: 'redirectregex.replacement', value: escapeCompose(replacement)},
  {name, key: 'redirectregex.permanent', value: String(permanent)},
];

const addEntry = (proxy, service, entry) => {
  proxy[service] = proxy[service] || [];
  const existing = proxy[service].find(candidate => candidate.hostname === entry.hostname &&
    candidate.pathname === entry.pathname);
  if (existing) return existing;
  proxy[service].push(entry);
  return entry;
};

/**
 * Translate model routes into a Lando `proxy:` block.
 *
 * @param {object} model Normalized Upsun model.
 * @param {{domain?: string, name?: string, domains?: string[]}} opts Local proxy options.
 * @param {object} targets Map of model app name to `{service, port}` describing which Lando service
 *   (and port) serves that app, eg `{app: {service: 'app_nginx', port: 80}}`.
 * @returns {{proxy: object, warnings: object[]}} Proxy config keyed by Lando service plus warnings.
 */
exports.getProxyConfig = (model, opts = {}, targets = {}) => {
  const proxy = {};
  const hosts = getLocalHosts(opts);
  const host = hosts[0];
  const entries = Object.entries(model.routes || {}).flatMap(([url, route], routeIndex) =>
    expandRouteUrls(url, route.to, hosts).map((pair, hostIndex) => ({
      url: pair.url, route: {...route, to: pair.to}, original: url,
      suffix: url.includes('{all}') && hosts.length > 1 ? `-${routeIndex}-${hostIndex}` : '',
    })));
  const defaultUrls = new Set(entries
    .filter(entry => entry.original.includes('{default}') && !entry.original.includes('{all}'))
    .map(entry => entry.url));
  const selected = entries.filter(entry => !entry.original.includes('{all}') || !defaultUrls.has(entry.url));
  const routes = Object.fromEntries(selected.map(entry => [entry.url, entry.route]));
  const primary = Object.values(model.routes || {}).find(route => route.primary && route.type === 'upstream');
  for (const {url: resolved, route, suffix: entrySuffix} of selected) {
    const upstream = resolveUpstream(route, routes) || (route.type === 'redirect' ? primary : null);
    if (!upstream || !upstream.upstream) continue;
    const appName = upstream.upstream.split(':')[0];
    const target = targets[appName];
    if (!target) continue;
    const parsed = new URL(resolved);
    const entry = {
      hostname: parsed.hostname,
      port: String(target.port),
      pathname: parsed.pathname || '/',
      middlewares: getMiddlewares(resolved, parsed.protocol === 'https:'),
    };
    const routeEntry = addEntry(proxy, target.service, entry);
    if (route.type === 'redirect') {
      // Match only the declared scheme: an http -> https upgrade route must not catch the https router.
      // Upsun upgrades http to https itself, so https redirect routes also cover plain http requests.
      const scheme = parsed.protocol === 'https:' ? 'https?' : 'http';
      routeEntry.middlewares.push(...getRedirectMiddlewares(
        `upsun-redirect-${parsed.protocol.replace(':', '')}${entrySuffix}`,
        `^${scheme}://${escapeHost(parsed.hostname)}${escapeRegex(withoutTrailingSlash(parsed.pathname))}(.*)$`,
        `${withoutTrailingSlash(route.to)}\${1}`,
        true,
      ));
      continue;
    }
    Object.entries(route.redirects?.paths || {}).forEach(([from, spec], index) => {
      const middlewareName = `upsun-redirect-${index}${entrySuffix}`;
      const replacement = replaceGroups(absoluteRedirect(spec.to, host));
      if (spec.regexp === true) {
        routeEntry.middlewares.push(...getRedirectMiddlewares(
          middlewareName,
          `^https?://${escapeHost(parsed.hostname)}${from.replace(/^\^/, '')}`,
          replacement,
          spec.code !== 302,
        ));
        return;
      }
      const suffix = spec.prefix === false ? '$' : '(.*)$';
      const appendSuffix = spec.append_suffix === false || spec.prefix === false ? '' : '${1}';
      const pathEntry = {
        hostname: parsed.hostname,
        port: String(target.port),
        pathname: from,
        middlewares: [
          ...getMiddlewares(`${parsed.protocol}//${parsed.host}${from}`, parsed.protocol === 'https:'),
          ...getRedirectMiddlewares(
            middlewareName,
            `^https?://${escapeHost(parsed.hostname)}${escapeRegex(from)}${suffix}`,
            `${replacement}${appendSuffix}`,
            spec.code !== 302,
          ),
        ],
      };
      addEntry(proxy, target.service, pathEntry);
    });
  }
  return {proxy, warnings: []};
};
