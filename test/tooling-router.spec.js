'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {expect} = require('chai');
const _ = require('lodash');
const router = require('../lib/tooling-router');

describe('tooling router', () => {
  it('ranks cwd ancestors the way core get-tasks does', () => {
    const cwd = path.resolve('/srv/project/web/subdir');
    expect(router.pathsToRoot(cwd)).to.deep.equal([
      cwd,
      path.resolve('/srv/project/web'),
      path.resolve('/srv/project'),
      path.resolve('/srv'),
    ]);
  });

  it('selects the nearest ancestor route and ignores directories below cwd', () => {
    const root = path.resolve('/srv/project');
    const routes = [
      {route: root, tooling: {php: {cmd: 'root'}}},
      {route: path.join(root, 'web'), tooling: {node: {cmd: 'web'}}},
      {route: path.join(root, 'api'), tooling: {python: {cmd: 'api'}}},
    ];
    expect(router.selectRoute(routes, path.join(root, 'web', 'src')).tooling).to.deep.equal({node: {cmd: 'web'}});
    expect(router.selectRoute(routes, root).tooling).to.deep.equal({php: {cmd: 'root'}});
    expect(router.selectRoute(routes, path.resolve('/other'))).to.equal(undefined);
  });

  it('pins empty root and closest routes even when other apps share those directories', () => {
    const root = path.resolve('/srv/project');
    const web = {route: path.join(root, 'web'), tooling: {node: {cmd: 'node'}}};
    const rooted = router.withRootFallback([web, web], root, [web.route]);
    expect(rooted.map(entry => entry.route)).to.deep.equal([root, web.route]);
    expect(rooted.every(entry => Object.keys(entry.tooling).length === 0)).to.equal(true);
    expect(router.selectRoute(rooted, web.route).tooling).to.deep.equal({});
    expect(_.orderBy(rooted, entry => router.pathsToRoot(web.route).indexOf(entry.route), 'asc')[0].tooling)
      .to.deep.equal({});
    expect(router.withRootFallback([{route: root, tooling: {php: {cmd: 'php'}}}], root, [root]))
      .to.deep.equal([{route: root, tooling: {}}]);
  });

  it('keeps Landofile commands and disables another runtime after the core merge', () => {
    const base = {
      php: {cmd: 'custom'},
      node: {cmd: 'from-recipe'},
      drush: {cmd: 'landofile'},
      composer: {cmd: 'composer'},
    };
    const routed = router.routeTooling(
      {node: {cmd: 'node-app'}, npm: {cmd: 'npm'}},
      ['php', 'composer'],
      ['php', 'drush'],
    );
    const merged = _.merge({}, base, routed);
    expect(merged.php).to.deep.equal({cmd: 'custom'});
    expect(merged.drush).to.deep.equal({cmd: 'landofile'});
    expect(merged.node).to.deep.equal({cmd: 'node-app'});
    expect(merged.npm).to.deep.equal({cmd: 'npm'});
    expect(merged.composer).to.equal(false);
    expect(_.isObject(false)).to.equal(false);
  });

  it('round-trips through the double JSON parse core uses for the router file', () => {
    const routes = [{
      route: '/srv/app',
      tooling: {php: {cmd: 'php', options: {auth: {interactive: {when: () => true}}}}},
    }];
    const encoded = JSON.stringify(router.forCache(routes));
    const loaded = JSON.parse(JSON.parse(encoded));
    expect(loaded).to.deep.equal([{
      route: '/srv/app',
      tooling: {php: {cmd: 'php', options: {auth: {interactive: {}}}}},
    }]);
  });

  it('keeps disabled foreign commands out of installed core warm-cache tasks', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-router-core-'));
    const previous = process.landoTaskCacheFile;
    try {
      process.landoTaskCacheFile = path.join(scratch, 'tasks');
      fs.writeFileSync(process.landoTaskCacheFile, JSON.stringify('{}'));
      const recipeCache = path.join(scratch, 'recipe');
      const toolingRouter = path.join(scratch, 'router');
      fs.writeFileSync(recipeCache, JSON.stringify({tooling: {
        php: {cmd: 'php'}, composer: {cmd: 'composer'}, node: {cmd: 'old-node'},
      }}));
      const routes = [{route: process.cwd(), tooling: router.routeTooling(
        {node: {cmd: 'node'}}, ['php', 'composer'], ['php'],
      )}];
      fs.writeFileSync(toolingRouter, JSON.stringify(router.forCache(routes)));
      const tasks = require('@lando/core/utils/get-tasks')({
        recipe: 'upsun', recipeCache, toolingRouter, tooling: {php: {cmd: 'custom'}},
      }, {_: ['node']});
      expect(tasks.map(task => task.command)).to.have.members(['php', 'node']);
    } finally {
      if (previous === undefined) delete process.landoTaskCacheFile;
      else process.landoTaskCacheFile = previous;
      fs.rmSync(scratch, {recursive: true, force: true});
    }
  });
});
