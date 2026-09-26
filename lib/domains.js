'use strict';

/**
 * Turn a project domain into a local DNS label, without decoding punycode.
 * @param {string} domain Project domain.
 * @returns {string} Lowercase alphanumeric label separated by single hyphens.
 */
const domainLabel = domain => domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * List the default local host first, then unique nonempty project-domain aliases.
 * @param {{name?: string, domain?: string, domains?: string[]}} [opts] Local proxy options.
 * @returns {string[]} Local hosts in configured order.
 */
const getLocalHosts = ({name = 'lando', domain = 'lndo.site', domains = []} = {}) => {
  const host = `${name}.${domain}`;
  return [...new Set([host, ...domains.map(domainLabel).filter(Boolean).map(label => `${label}.${host}`)])];
};

/**
 * Expand all-domain routes and pair their destinations with the same local host.
 * Default placeholders always use the first host; routes without all expand only once.
 * @param {string} url Original route URL.
 * @param {string|null|undefined} to Original redirect destination.
 * @param {string[]} hosts Nonempty local host list with the default first.
 * @returns {{url: string, to: string|null|undefined}[]} Resolved route pairs.
 */
const expandRouteUrls = (url, to, hosts) => (url.includes('{all}') ? hosts : hosts.slice(0, 1)).map(host => {
  const resolve = value => value.replace(/\{default\}/g, hosts[0]).replace(/\{all\}/g, host);
  return {url: resolve(url), to: to == null ? to : resolve(to)};
});

module.exports = {domainLabel, getLocalHosts, expandRouteUrls};
