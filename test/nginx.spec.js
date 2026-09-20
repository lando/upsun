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
});
