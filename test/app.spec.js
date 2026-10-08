'use strict';

const {expect} = require('chai');
const appHook = require('../app');

const makeApp = recipe => {
  const events = {};
  const listeners = {};
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
        const fn = rest[rest.length - 1];
        const priority = typeof rest[0] === 'number' ? rest[0] : 5;
        (listeners[name] ||= []).push({priority, fn});
        priorities[name] = priority;
        events[name] = (...args) => {
          let result;
          for (const listener of listeners[name].slice().sort((a, b) => a.priority - b.priority)) {
            result = listener.fn(...args);
          }
          return result;
        };
      }},
      upsun: {
        warnings: [{code: 'version-fallback', message: 'x'}],
        cli: {vendor: 'upsun'},
        closestApp: 'drupal',
        startCommands: {
          'drupal': [
            {name: 'mounts', cmd: 'mkdir -p "/app/x"', user: 'app'},
            {name: 'custom', cmd: 'echo custom', user: 'root', env: {UPSUN_CLI_TOKEN: 'tok'}},
          ],
          'drupal--queue': [{name: 'mounts', cmd: 'mkdir -p "/app/q"', user: 'app'}],
          'ghost': [{name: 'mounts', cmd: 'x', user: 'app'}],
        },
      },
    },
    events, listeners, messages, priorities, runs, warnings,
  };
};

describe('app.js', () => {
  describe('post-auth', () => {
    const api = require('../lib/api');
    let originalFetch;
    let originalDelay;
    let originalLog;
    let data;
    let lines;
    let removed;
    let app;
    let events;

    beforeEach(() => {
      originalFetch = global.fetch;
      originalDelay = api.RETRY_DELAY_MS;
      originalLog = console.log;
      api.RETRY_DELAY_MS = 0;
      lines = [];
      removed = [];
      console.log = line => lines.push(line);
      data = {'upsun.tokens': [{token: 'chosen', email: 'old@example.com', date: 1}],
        'test.meta.cache': {token: 'chosen', email: 'old@example.com', other: 'preserved'}};
      ({app, events} = makeApp('upsun'));
    });

    afterEach(() => {
      global.fetch = originalFetch;
      api.RETRY_DELAY_MS = originalDelay;
      console.log = originalLog;
    });

    const register = () => appHook(app, {cache: {
      get: key => data[key],
      set: (key, value) => {
        data[key] = value;
      },
      remove: key => {
        delete data[key];
        removed.push(key);
      },
    }});

    for (const vendor of ['upsun', 'platformsh']) {
      it(`saves the connected account for ${vendor} when validation succeeds`, async () => {
        // Given
        app.upsun.cli.vendor = vendor;
        global.fetch = async url => ({ok: true, json: async () =>
          url.endsWith('/me') ? {mail: 'connected@example.com'} : {access_token: 'access'}});
        register();
        // When
        await events['post-auth']({}, {auth: 'pasted'});
        // Then
        expect(data[`${vendor}.tokens`].find(entry => entry.token === 'pasted'))
          .to.include({email: 'connected@example.com'});
        expect(data['test.meta.cache']).to.include({token: 'pasted', email: 'connected@example.com',
          other: 'preserved'});
        expect(data['test.meta.cache'].date).to.be.a('number');
        expect(lines).to.deep.equal(['Logged in to Upsun as connected@example.com.']);
        expect(lines.join('\n')).not.to.include('pasted');
        expect(removed).to.deep.equal(['test.recipe.cache', 'test.tooling.router']);
      });
    }

    for (const status of [400, 401, 403]) {
      it(`removes the rejected account when Upsun returns ${status}`, async () => {
        // Given
        global.fetch = async () => ({ok: false, status, json: async () => ({message: 'invalid'})});
        register();
        // When
        const error = await events['post-auth']({}, {auth: 'chosen'}).catch(error => error);
        // Then
        expect(error.message).to.equal('Upsun rejected that API token. Run lando auth upsun again to log in.');
        expect(data['upsun.tokens']).to.deep.equal([]);
        expect(data['test.meta.cache']).to.deep.equal({other: 'preserved'});
        expect(removed).to.deep.equal(['test.recipe.cache', 'test.tooling.router']);
      });
    }

    for (const failure of ['503', 'network']) {
      it(`keeps the account when validation fails with ${failure}`, async () => {
        // Given
        global.fetch = async () => {
          if (failure === 'network') throw new Error('offline');
          return {ok: false, status: 503, json: async () => ({message: 'offline'})};
        };
        register();
        // When
        const error = await events['post-auth']({}, {auth: 'chosen'}).catch(error => error);
        // Then
        expect(error.message).to.equal('Couldn\'t reach Upsun to check the token: offline');
        expect(data['upsun.tokens']).to.deep.equal([{token: 'chosen', email: 'old@example.com', date: 1}]);
        expect(data['test.meta.cache']).to.include({token: 'chosen', email: 'old@example.com'});
        expect(removed).to.deep.equal([]);
      });
    }

    for (const auth of [undefined, '', 'more', 'browser']) {
      it(`rejects incomplete authentication when the answer is ${auth}`, async () => {
        // Given
        global.fetch = () => {
          throw new Error('Must not call Upsun');
        };
        register();
        // When
        const error = await events['post-auth']({}, {auth}).catch(error => error);
        // Then
        expect(error.message).to.equal('No API token was provided. Run lando auth upsun again.');
      });
    }

    it('saves the selected account and drops tooling caches after pull and switch', async () => {
      global.fetch = async url => ({ok: true, json: async () =>
        url.endsWith('/me') ? {mail: 'connected@example.com'} : {access_token: 'access'}});
      register();
      await events['post-pull']({}, {auth: 'pasted'});
      expect(data['test.meta.cache']).to.include({token: 'pasted', email: 'connected@example.com'});
      expect(removed).to.deep.equal(['test.recipe.cache', 'test.tooling.router']);
      removed.length = 0;
      await events['post-switch']({}, {auth: 'pasted'});
      expect(removed).to.deep.equal(['test.recipe.cache', 'test.tooling.router']);
      removed.length = 0;
      await events['post-push']({}, {});
      expect(removed).to.deep.equal([]);
    });

    for (const command of ['pull', 'push', 'switch']) {
      for (const status of [400, 401, 403]) {
        it(`warns and scrubs a rejected token after successful ${command} (${status})`, async () => {
          const warnings = [];
          app.log.warn = (...args) => warnings.push(args);
          data['platformsh.tokens'] = data['upsun.tokens'];
          data['test.recipe.cache'] = {};
          data['test.tooling.router'] = '[]';
          global.fetch = async () => ({ok: false, status, json: async () => ({message: 'invalid'})});
          register();
          await events[`post-${command}`]({}, {auth: 'chosen'});
          expect(data['upsun.tokens']).to.deep.equal([]);
          expect(data['platformsh.tokens']).to.deep.equal([]);
          expect(data['test.meta.cache']).to.deep.equal({other: 'preserved'});
          expect(removed).to.deep.equal(['test.recipe.cache', 'test.tooling.router']);
          expect(warnings).to.deep.equal([[
            'Upsun rejected the API token; it has been removed. Run lando auth upsun again to log in.',
          ]]);
        });
      }
      for (const failure of ['503', 'network']) {
        it(`warns without failing successful ${command} or removing tokens on ${failure}`, async () => {
          const warnings = [];
          app.log.warn = (...args) => warnings.push(args);
          global.fetch = async () => {
            if (failure === 'network') throw new Error('offline');
            return {ok: false, status: 503, json: async () => ({message: 'offline'})};
          };
          register();
          await events[`post-${command}`]({}, {auth: 'chosen'});
          expect(data['upsun.tokens']).to.deep.equal([{token: 'chosen', email: 'old@example.com', date: 1}]);
          expect(data['test.meta.cache']).to.include({token: 'chosen', email: 'old@example.com'});
          expect(removed).to.deep.equal([]);
          expect(warnings).to.deep.equal([['could not refresh the Upsun account cache: %s', 'offline']]);
        });
      }
    }

    it('preserves another account metadata when post-sync validation rejects a token', async () => {
      app.log.warn = () => {};
      data['test.meta.cache'] = {token: 'other', email: 'other@example.com'};
      global.fetch = async () => ({ok: false, status: 401, json: async () => ({message: 'invalid'})});
      register();
      await events['post-pull']({}, {auth: 'chosen'});
      expect(data['test.meta.cache']).to.deep.equal({token: 'other', email: 'other@example.com'});
    });
  });

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
    expect(events).to.include.all.keys('post-pull', 'post-push', 'post-switch');
  });

  it('applies the cwd route before core builds tasks and persists disabled cache markers', async () => {
    const {app} = makeApp('upsun');
    const writes = [];
    const removed = [];
    const AsyncEvents = require('@lando/core/lib/events');
    const addTooling = require('@lando/core/hooks/app-add-tooling');
    app.log.debug = () => {};
    app.log.silly = () => {};
    app.events = new AsyncEvents(app.log);
    app.tasks = [];
    app.config.tooling = {php: {cmd: 'closest'}};
    app.upsun.toolingRouter = [{route: process.cwd(), tooling: {php: false, node: {cmd: 'node'}}}];
    appHook(app, {cache: {
      set: (key, value, options) => writes.push({key, value, options}),
      remove: key => removed.push(key),
    }});
    app.events.on('post-init', 5, () => addTooling(app, {}));
    await app.events.emit('post-init');
    expect(app.tasks.map(task => task.command)).to.deep.equal(['node']);
    expect(app.config.tooling).to.deep.equal({node: {cmd: 'node'}});
    expect(writes).to.deep.equal([{
      key: 'test.tooling.router',
      value: JSON.stringify(app.upsun.toolingRouter),
      options: {persist: true},
    }]);
    expect(JSON.parse(JSON.parse(JSON.stringify(writes[0].value)))[0].tooling.node.cmd).to.equal('node');
    await app.events.emit('post-uninstall');
    expect(removed).to.deep.equal(['test.tooling.router']);
  });

  it('keeps Landofile overrides and removes disabled commands with an empty closest route', () => {
    const {app, events} = makeApp('upsun');
    app.config.tooling = {composer: {cmd: 'custom', description: 'User composer'}, node: false};
    app.upsun.toolingRouter = [{route: process.cwd(), tooling: {}}];
    appHook(app, {cache: {set: () => {}}});
    events['post-init']();
    expect(app.config.tooling).to.deep.equal({composer: {cmd: 'custom', description: 'User composer'}});
  });

  for (const cached of [false, true]) {
    it(`replaces routed data choices when rebuilding ${cached ? 'cached' : 'cold'} tooling`, async () => {
      const _ = require('lodash');
      const {getPullTask} = require('../lib/pull');
      const {getInteractive} = require('@lando/core/lib/formatters');
      const AsyncEvents = require('@lando/core/lib/events');
      const addTooling = require('@lando/core/hooks/app-add-tooling');
      const model = {applications: {
        web: {relationships: {database: {service: 'db'}, reports: {service: 'db'}},
          mounts: {'/web/files': {}, '/web/private': {}}},
        api: {relationships: {database: {service: 'db'}}, mounts: {'/api/files': {}}},
      }, services: {db: {type: {service: 'mariadb'}}}};
      const cli = {binary: 'upsun', vendor: 'upsun', tokenVar: 'UPSUN_CLI_TOKEN'};
      const web = {pull: getPullTask(model, 'web', cli)};
      const api = {pull: getPullTask(model, 'api', cli)};
      const {app} = makeApp('upsun');
      app.log.debug = () => {};
      app.log.silly = () => {};
      app.events = new AsyncEvents(app.log);
      app.tasks = [];
      app.config.tooling = cached ? _.merge({}, JSON.parse(JSON.stringify(web)), JSON.parse(JSON.stringify(api))) : web;
      app.upsun.toolingRouter = [{route: process.cwd(), tooling: api}];
      appHook(app, {cache: {set: () => {}}});
      app.events.on('post-init', 5, () => addTooling(app, {}));

      await app.events.emit('post-init');

      const task = app.tasks.find(task => task.command === 'pull');
      const questions = getInteractive(task.options, {});
      expect(app.config.tooling.pull.service).to.equal('api');
      expect(questions.find(question => question.name === 'relationship').choices).to.deep.equal(['database']);
      expect(questions.find(question => question.name === 'mount').choices).to.deep.equal(['/api/files']);
    });
  }

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
