'use strict';

const {expect} = require('chai');
const {renderVhost} = require('../lib/nginx');

describe('lib/nginx', () => {
  it('uses an explicit PHP-FPM host without changing the default host', () => {
    expect(renderVhost({web: {}}, '.', {fpmHost: 'web'})).to.include('fastcgi_pass web:9000;');
    expect(renderVhost({web: {}}, '.')).to.include('fastcgi_pass fpm:9000;');
  });

  it('rejects directive injection in locations, index, passthru, rules and headers', () => {
    for (const [key, location, field, value] of [
      ['/; injected', {}, 'prefix', '/; injected'],
      ['/', {index: ['index.php;']}, 'index', 'index.php;'],
      ['/', {passthru: '/index.php;'}, 'passthru', '/index.php;'],
      ['/', {passthru: '/$uri'}, 'passthru', '/$uri'],
      ['/', {rules: {'x; injected': {}}}, 'rules', 'x; injected'],
      ['/', {allow: 'yes; injected'}, 'allow', 'yes; injected'],
      ['/', {scripts: 'yes\ninjected'}, 'scripts', 'yes\ninjected'],
      ['/', {expires: '1h; injected'}, 'expires', '1h; injected'],
      ['/', {headers: {'X-Bad\n': 'value'}}, 'headers', 'X-Bad\n'],
      ['/', {headers: {'X-Test': 'value; injected'}}, 'headers', 'value; injected'],
      ['/', {rules: {'^/ok': {passthru: '/bad;'}}}, 'rules["^/ok"].passthru', '/bad;'],
    ]) {
      expect(() => renderVhost({web: {locations: {[key]: location}}}, '.'))
        .to.throw(`web.locations["${key}"].${field} contains characters nginx config cannot accept: ${value}`);
    }
  });

  it('rejects injected allow and scripts values after config normalization', () => {
    const {normalize} = require('../lib/config/normalize');
    for (const field of ['allow', 'scripts']) {
      const app = normalize({applications: {app: {web: {locations: {'/': {[field]: 'bad;'}}}}}}, 'flex')
        .applications.app;
      expect(() => renderVhost(app, '.')).to.throw(`web.locations["/"].${field}`);
    }
  });

  it('quotes and escapes header backslashes and quotes', () => {
    const app = {web: {locations: {'/': {headers: {'X-Test': 'a\\b"c'}}}}};
    expect(renderVhost(app, '.')).to.include('add_header "X-Test" "a\\\\b\\"c";');
  });

  it('contains roots inside the application, treating leading slashes as app-relative', () => {
    for (const root of ['../outside', '/../../outside', 'web/../../outside']) {
      const app = {sourceRoot: 'backend', web: {locations: {'/': {root}}}};
      expect(() => renderVhost(app, 'backend/web')).to.throw('root escapes application source root');
    }
    const app = {sourceRoot: 'backend', web: {locations: {'/files': {root: '/web/files'}}}};
    expect(renderVhost(app, 'backend/web')).to.include('alias "{{LANDO_WEBROOT}}/files";');
  });

  it('nests rules in their parent location and inherits headers and denial', () => {
    const vhost = renderVhost({web: {locations: {
      '/assets': {root: 'files', allow: false, headers: {'X-Parent': 'yes'}, rules: {
        '\\.(css|js)$': {headers: {'X-Rule': 'yes'}},
      }},
    }}}, 'web');
    const parent = vhost.indexOf('    location /assets {');
    const rule = vhost.indexOf('        location ~ \\.(css|js)$ {');
    const close = vhost.indexOf('\n    }', parent);
    expect(parent).to.be.below(rule);
    expect(rule).to.be.below(close);
    expect(vhost.slice(parent, rule)).to.include('alias "{{LANDO_WEBROOT}}/../files";');
    expect(vhost.slice(rule, close)).to.include('deny all;');
    expect(vhost.slice(rule, close)).to.include('add_header "X-Parent" "yes";');
    expect(vhost.slice(rule, close)).to.include('add_header "X-Rule" "yes";');
  });

  it('renders a front-controller vhost from web.locations', () => {
    const app = {web: {locations: {
      '/': {root: 'web', passthru: '/index.php', index: ['index.php'], expires: '6M', allow: false, rules: {
        '\\.(css|js)$': {allow: true},
        '^/sites/[^/]+/settings.*?\\.php$': {scripts: false},
      }},
      '/sites/default/files': {root: 'web/sites/default/files', allow: true, passthru: '/index.php', scripts: false},
    }}};
    const vhost = renderVhost(app, 'web');
    expect(vhost).to.include('root "{{LANDO_WEBROOT}}";');
    expect(vhost).to.include('location / {');
    expect(vhost).to.include('try_files /dev/null /index.php$is_args$args;');
    expect(vhost).to.include('expires 180d;');
    expect(vhost).to.include('location ~ \\.(css|js)$ {\n            try_files $uri =404;');
    expect(vhost).to.include('location ^~ /sites/default/files {');
    expect(vhost).to.include('alias "{{LANDO_WEBROOT}}/sites/default/files";');
    expect(vhost).to.include('location ~ \\.php(/|$) { deny all; }');
    expect(vhost).to.include('fastcgi_pass fpm:9000;');
    // longest prefix first so nested paths are declared before /
    expect(vhost.indexOf('/sites/default/files {')).to.be.below(vhost.indexOf('location / {'));
  });

  it('anchors location roots under the app source root', () => {
    const app = {sourceRoot: 'backend', web: {locations: {
      '/': {root: 'web', passthru: '/index.php'},
      '/files': {root: 'web/files', allow: true},
    }}};
    const vhost = renderVhost(app, 'backend/web');
    expect(vhost).to.not.include('alias "{{LANDO_WEBROOT}}/../');
    expect(vhost).to.include('alias "{{LANDO_WEBROOT}}/files";');
  });

  it('falls back to a plain index.php passthru without locations', () => {
    expect(renderVhost({web: {}}, '.')).to.include('try_files $uri $uri/ /index.php$is_args$args;');
  });

  it('proxies passthru locations to the app upstream', () => {
    const app = {web: {locations: {
      '/': {root: 'public', passthru: true, rules: {'^/api': {passthru: true}}},
      '/private': {root: 'private', passthru: true, allow: false},
    }}};
    const vhost = renderVhost(app, 'public', {upstream: {service: 'api', port: 8888}});
    expect(vhost).to.include('index index.html;');
    expect(vhost).to.include('proxy_pass http://api:8888;');
    expect(vhost).to.include('proxy_set_header Host $host;');
    expect(vhost).to.include('try_files $uri $uri/ @upsun_upstream;');
    expect(vhost).to.include('try_files /dev/null @upsun_upstream;');
    expect(vhost).to.include('location ~ ^/api {\n            try_files $uri $uri/ @upsun_upstream;');
    expect(vhost).not.to.include('fastcgi_pass');
    expect(vhost).not.to.include('location ~ \\.php(/|$) {');
  });

  it('serves static locations without an upstream fallback', () => {
    const app = {web: {locations: {'/': {root: 'public'}}}};
    const vhost = renderVhost(app, 'public', {upstream: {service: 'api', port: 8888}});
    expect(vhost).to.include('try_files $uri $uri/ =404;');
    expect(vhost).not.to.include('fastcgi_pass');
  });

  it('proxies requests when upstream mode has no locations', () => {
    const vhost = renderVhost({web: {}}, '.', {upstream: {service: 'api', port: 8888}});
    expect(vhost).to.include('location / {\n        try_files $uri $uri/ @upsun_upstream;');
  });
});
