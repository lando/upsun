'use strict';

const {expect} = require('chai');
const {renderVhost} = require('../lib/nginx');

describe('lib/nginx', () => {
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
    expect(vhost).to.include('location ~ \\.(css|js)$ {\n        try_files $uri =404;');
    expect(vhost).to.include('location ^~ /sites/default/files {');
    expect(vhost).to.include('alias "{{LANDO_WEBROOT}}/sites/default/files";');
    expect(vhost).to.include('location ~ \\.php(/|$) { deny all; }');
    expect(vhost).to.include('fastcgi_pass fpm:9000;');
    // longest prefix first so nested paths are declared before /
    expect(vhost.indexOf('/sites/default/files {')).to.be.below(vhost.indexOf('location / {'));
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
    expect(vhost).to.include('location ~ ^/api {\n        try_files $uri $uri/ @upsun_upstream;');
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
