'use strict';

const {expect} = require('chai');
const appHook = require('../app');

const makeApp = recipe => {
  const events = {};
  const warnings = [];
  return {
    app: {
      id: 'orig', name: 'test',
      config: {recipe, config: {id: 'proj'}},
      log: {verbose: () => {}, alsoSanitize: () => {}},
      addWarning: warning => warnings.push(warning),
      events: {on: (name, ...rest) => {
        events[name] = rest[rest.length - 1];
      }},
      upsun: {warnings: [{code: 'version-fallback', message: 'x'}], cli: {vendor: 'upsun'}, closestApp: 'drupal'},
    },
    events, warnings,
  };
};

describe('app.js', () => {
  it('ignores non-upsun recipes', () => {
    const {app, events} = makeApp('lamp');
    appHook(app, {});
    expect(app.id).to.equal('orig');
    expect(events).to.deep.equal({});
  });

  it('sets the app id and surfaces recipe warnings on post-init', () => {
    const {app, events, warnings} = makeApp('upsun');
    appHook(app, {});
    expect(app.id).to.equal('proj');
    events['post-init']();
    events['ready']();
    expect(app._defaultService).to.equal('drupal');
    expect(warnings[0].title).to.equal('Service version substituted');
    expect(warnings[0].url).to.include('#version-fallback');
    expect(events).to.include.all.keys('post-pull', 'post-push');
  });

  it('warns about the deprecated platformsh recipe alias', () => {
    const {app, warnings} = makeApp('platformsh');
    appHook(app, {});
    expect(warnings[0].title).to.equal('Deprecated recipe name');
  });
});

describe('index.js', () => {
  const indexHook = require('../index');
  const run = (recipe, options = {}) => {
    const handlers = {};
    indexHook({log: {alsoSanitize: () => {}}, events: {on: (name, fn) => {
      handlers[name] = fn;
    }}});
    const app = {recipe, primary: 'drupal', info: [{service: 'drupal'}, {service: 'db'}]};
    const data = {options: {_app: app, service: 'appserver', ...options}};
    handlers['cli-ssh-run'](data);
    return data.options;
  };

  it('leaves ssh alone for other recipes', () => {
    const options = run('lamp');
    expect(options.service).to.equal('appserver');
    expect(options.command).to.equal(undefined);
  });

  it('sends lando ssh to the primary app with the Upsun environment', () => {
    const options = run('upsun');
    expect(options.service).to.equal('drupal');
    expect(options.command[0]).to.equal('/helpers/upsun-exec.sh');
    expect(run('upsun', {service: 'db', command: 'ls'}).command).to.deep.equal([
      '/helpers/upsun-exec.sh', '/bin/sh', '-c', 'ls',
    ]);
  });
});
