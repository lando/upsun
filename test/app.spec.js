'use strict';

const {expect} = require('chai');
const appHook = require('../app');

const makeApp = recipe => {
  const events = {};
  const priorities = {};
  const warnings = [];
  const messages = [];
  const runs = [];
  return {
    app: {
      id: 'orig', name: 'test',
      config: {recipe, config: {id: 'proj'}},
      containers: {'drupal': 'c-drupal', 'drupal--queue': 'c-queue'},
      services: ['drupal', 'drupal--queue'],
      compose: ['a.yml'],
      project: 'proj',
      info: [{service: 'drupal', meUser: 'www-data'}, {service: 'drupal--queue', meUser: 'node'}],
      log: {verbose: () => {}, info: () => {}, alsoSanitize: () => {}},
      addWarning: warning => warnings.push(warning),
      addMessage: (message, error) => messages.push({...message, error}),
      engine: {run: steps => {
        runs.push(steps);
        return Promise.resolve();
      }},
      events: {on: (name, ...rest) => {
        if (typeof rest[0] === 'number') priorities[name] = rest[0];
        events[name] = rest[rest.length - 1];
      }},
      upsun: {
        warnings: [{code: 'version-fallback', message: 'x'}],
        cli: {vendor: 'upsun'},
        closestApp: 'drupal',
        startCommands: {
          'drupal': [
            {name: 'mounts', cmd: 'mkdir -p "/app/x"', user: 'app'},
            {name: 'tether', cmd: '/helpers/upsun-tether.sh open', user: 'root', env: {UPSUN_CLI_TOKEN: 'tok'}},
          ],
          'drupal--queue': [{name: 'mounts', cmd: 'mkdir -p "/app/q"', user: 'app'}],
          'ghost': [{name: 'mounts', cmd: 'x', user: 'app'}],
        },
      },
    },
    events, messages, priorities, runs, warnings,
  };
};

describe('app.js', () => {
  it('gives exact proxy hosts priority over wildcards on HTTP and HTTPS', () => {
    const {app, events, priorities} = makeApp('upsun');
    const compose = [];
    app.add = data => compose.push(data);
    app.ComposeService = class {
      constructor(...args) {
        this.data = args[2];
      }
    };
    app.config.proxy = {
      app_nginx: [{id: 'wild', hostname: '*.test.lndo.site', pathname: '/deep/path'}],
      api: [
        {id: 'exact', hostname: 'www.test.lndo.site', pathname: '/'},
        {id: 'path', hostname: 'www.test.lndo.site', pathname: '/old'},
      ],
    };
    appHook(app, {utils: {dumpComposeData: () => ['proxy-priorities.yml']}});
    expect(events['pre-start'], 'proxy priority hook').to.be.a('function');
    expect(priorities['pre-start']).to.be.greaterThan(1);
    events['pre-start']();
    const {services} = compose[0].data;
    for (const suffix of ['', '-secured']) {
      const priority = (service, id) =>
        Number(services[service].labels[`traefik.http.routers.${id}${suffix}.priority`]);
      expect(priority('api', 'exact')).to.be.greaterThan(priority('app_nginx', 'wild'));
      expect(priority('api', 'path')).to.be.greaterThan(priority('api', 'exact'));
    }
    app.config.proxy.app_nginx = [];
    events['pre-start']();
    expect(compose).to.have.length(1);
  });

  it('keeps the core default service when the closest app has no service', () => {
    const {app, events} = makeApp('upsun');
    appHook(app, {});
    app._defaultService = 'drupal--queue';
    app.services = ['drupal--queue', 'mailpit'];
    events['ready']();
    expect(app._defaultService).to.equal('drupal--queue');
  });

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

  it('builds engine.run commands for every start command', () => {
    const {app} = makeApp('upsun');
    const commands = appHook.buildRunCommands(app);
    expect(commands).to.have.length(3);
    expect(commands[0]).to.deep.equal({
      id: 'c-drupal',
      cmd: ['/helpers/exec-multiliner.sh', Buffer.from('mkdir -p "/app/x"').toString('base64')],
      compose: ['a.yml'],
      project: 'proj',
      api: 3,
      opts: {
        mode: 'attach',
        user: 'www-data',
        services: ['drupal'],
        cstdio: 'inherit',
        environment: {},
        upsunStep: 'drupal:mounts',
      },
    });
    expect(commands[1].opts.user).to.equal('root');
    expect(commands[1].opts.environment).to.deep.equal({UPSUN_CLI_TOKEN: 'tok'});
    expect(commands[2].opts.user).to.equal('node');
  });

  it('runs the start commands on post-start after build steps', async () => {
    const {app, events, priorities, runs} = makeApp('upsun');
    appHook(app, {});
    expect(priorities['post-start']).to.equal(101);
    await events['post-start']();
    expect(runs).to.have.length(1);
    expect(runs[0]).to.have.length(3);
  });

  it('does nothing without start commands', () => {
    const {app, events, runs} = makeApp('upsun');
    app.upsun.startCommands = {};
    appHook(app, {});
    expect(events['post-start']()).to.equal(undefined);
    expect(runs).to.have.length(0);
  });

  it('passes start command failures to addMessage so lando exits nonzero', async () => {
    const {app, events, messages} = makeApp('upsun');
    app.engine.run = () => Promise.reject(new Error('failed'));
    appHook(app, {});
    await events['post-start']();
    expect(messages[0].title).to.equal('One of your Upsun start commands failed');
    expect(messages[0].command).to.equal('lando restart');
    // Lando core turns a message error into lando.exitCode (error.code ?? 17)
    expect(messages[0].error.message).to.equal('failed');
  });

  it('adds the tether environment to lando info', () => {
    const {app, events} = makeApp('upsun');
    app.upsun.tethered = true;
    app.upsun.tetherEnvironment = 'staging';
    appHook(app, {});
    events['post-info']();
    expect(app.info[0].tethered).to.equal('staging');
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
    const app = {recipe, primary: 'drupal', info: [
      {service: 'drupal', type: 'php'}, {service: 'db', type: 'mariadb'}, {service: 'mailpit', type: 'mailpit'},
    ]};
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
    expect(run('upsun', {service: 'drupal', command: 'ls'}).command).to.deep.equal([
      '/helpers/upsun-exec.sh', '/bin/sh', '-c', 'ls',
    ]);
  });

  it('leaves ssh into non-app services unwrapped', () => {
    expect(run('upsun', {service: 'db', command: 'ls'}).command).to.equal('ls');
    expect(run('upsun', {service: 'mailpit'}).command).to.equal(undefined);
  });
});
