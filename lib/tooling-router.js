'use strict';

const path = require('path');

/**
 * Ancestors of a directory, including itself, matching core get-tasks pathsToRoot.
 * @param {string} [startFrom] Directory to walk upward from.
 * @returns {string[]} Absolute directories from startFrom toward the filesystem root.
 */
const pathsToRoot = (startFrom = process.cwd()) => {
  const parts = path.dirname(startFrom).split(path.sep);
  const paths = [startFrom];
  for (let end = 0; end < parts.length; end++) paths.push(parts.slice(0, parts.length - end).join(path.sep));
  paths.pop();
  return paths;
};

/**
 * Pick the route whose directory is the closest ancestor of cwd.
 * @param {{route: string, tooling: object}[]} routes Router entries.
 * @param {string} [cwd] Directory the command was launched from.
 * @returns {{route: string, tooling: object}|undefined} Closest entry.
 */
const selectRoute = (routes, cwd = process.cwd()) => routes
  .map(route => ({...route, closeness: pathsToRoot(cwd).indexOf(route.route)}))
  .filter(route => route.closeness !== -1)
  .sort((a, b) => a.closeness - b.closeness)[0];

/**
 * Preserve recipe/Landofile tooling at the root and closest app paths; deduplicate routes.
 * @param {{route: string, tooling: object}[]} routes Per-app routes.
 * @param {string} root Absolute Landofile directory.
 * @param {string[]} closestPaths Absolute source directories of the closest app.
 * @returns {{route: string, tooling: object}[]} Routes including the root fallback.
 */
const withRootFallback = (routes, root, closestPaths) => {
  const seen = new Set();
  return [...[root, ...closestPaths].map(route => ({route, tooling: {}})), ...routes].filter(entry => {
    if (seen.has(entry.route)) return false;
    seen.add(entry.route);
    return true;
  });
};

/**
 * Drop Landofile-owned commands and disable missing commands from the closest app's base.
 * Core's warm get-tasks skips non-object tasks; live app tooling must remove these markers.
 * @param {Record<string, object>} tooling Generated tooling for this app.
 * @param {string[]} baseKeys Command names generated for the closest app.
 * @param {string[]} userKeys Command names defined in the Landofile.
 * @returns {Record<string, object|boolean>} Tooling safe to merge over the recipe cache.
 */
const routeTooling = (tooling, baseKeys, userKeys) => {
  const owned = new Set(userKeys);
  /** @type {Record<string, object|boolean>} */
  const result = {};
  for (const [name, task] of Object.entries(tooling)) {
    if (!owned.has(name)) result[name] = task;
  }
  for (const name of baseKeys) {
    if (!owned.has(name) && !Object.hasOwn(tooling, name)) result[name] = false;
  }
  return result;
};

/**
 * Encode router entries for core's double JSON.parse after cache.set persists them.
 * Interactive functions do not survive; app-level commands reload them during init.
 * @param {object[]} routes Router entries.
 * @returns {string} JSON text stored via cache.set.
 */
const forCache = routes => JSON.stringify(routes);

/**
 * Remove persisted tooling that still carries a previous token, option set, or env.
 * Core reads recipe.cache and tooling.router on the warm path, before app init.
 * @param {{remove: function(string): void}} cache Lando cache.
 * @param {string} name App name.
 * @returns {void}
 */
const clearToolingCaches = (cache, name) => {
  cache.remove(`${name}.recipe.cache`);
  cache.remove(`${name}.tooling.router`);
};

exports.pathsToRoot = pathsToRoot;
exports.selectRoute = selectRoute;
exports.withRootFallback = withRootFallback;
exports.routeTooling = routeTooling;
exports.forCache = forCache;
exports.clearToolingCaches = clearToolingCaches;
