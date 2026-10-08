'use strict';

const path = require('path').posix;

// Upsun expires values: -1 (off), seconds, or a number suffixed s/m/h/d/w/M/y
const toNginxExpires = value => {
  if (value === undefined || value === null || value === -1 || value === '-1') return 'off';
  if (typeof value === 'number') return `${value}s`;
  const match = String(value).match(/^(\d+)([smhdwMy])?$/);
  if (!match) return 'off';
  const [, amount, unit = 's'] = match;
  return {s: `${amount}s`, m: `${amount}m`, h: `${amount}h`, d: `${amount}d`,
    w: `${Number(amount) * 7}d`, M: `${Number(amount) * 30}d`, y: `${Number(amount) * 365}d`}[unit];
};

const quote = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const validateLocation = (key, location, field = '') => {
  const reject = (name, value) => {
    throw new Error(`web.locations["${key}"].${field}${name} contains characters nginx config cannot accept: ${value}`);
  };
  const unsafe = value => [...String(value)].some(char =>
    char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || ';{}'.includes(char));
  for (const name of ['allow', 'expires', 'scripts', 'root']) {
    if (unsafe(location[name] ?? '')) reject(name, location[name]);
  }
  for (const entry of location.index || []) {
    if (!/^[^\s{};#"']+$/.test(entry)) reject('index', entry);
  }
  if (location.passthru != null && typeof location.passthru !== 'boolean' &&
    (typeof location.passthru !== 'string' || !/^\/[^\s{};#"'$]*$/.test(location.passthru))) {
    reject('passthru', location.passthru);
  }
  for (const [name, value] of Object.entries(location.headers || {})) {
    if (unsafe(name)) reject('headers', name);
    if (unsafe(value)) reject('headers', value);
  }
  for (const [pattern, rule] of Object.entries(location.rules || {})) {
    if (/[{};#\r\n]/.test(pattern)) reject('rules', pattern);
    validateLocation(key, rule, `${field}rules["${pattern}"].`);
  }
};

const php = fpmHost => [
  '    location ~ \\.php(/|$) {',
  '        fastcgi_split_path_info ^(.+?\\.php)(/.*)$;',
  `        fastcgi_pass ${fpmHost}:9000;`,
  '        fastcgi_index index.php;',
  '        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;',
  '        fastcgi_param PATH_INFO $fastcgi_path_info;',
  '        fastcgi_buffers 256 128k;',
  '        fastcgi_connect_timeout 300s;',
  '        fastcgi_send_timeout 300s;',
  '        fastcgi_read_timeout 300s;',
  '        include fastcgi_params;',
  '    }',
];

const proxy = upstream => [
  '    location @upsun_upstream {',
  `        proxy_pass http://${upstream.service}:${upstream.port};`,
  '        proxy_set_header Host $host;',
  '        proxy_set_header X-Real-IP $remote_addr;',
  '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  '        proxy_set_header X-Forwarded-Proto $scheme;',
  '        proxy_http_version 1.1;',
  '        proxy_set_header Upgrade $http_upgrade;',
  '        proxy_set_header Connection "upgrade";',
  '    }',
];

const headers = location => Object.entries(location.headers || {})
    .map(([name, value]) => `        add_header ${quote(name)} ${quote(value)};`);

const rules = (location, passthru, upstream, fpmHost) => Object.entries(location.rules || {})
  .flatMap(([pattern, rule]) => {
  rule = {...rule, allow: rule.allow ?? location.allow, scripts: rule.scripts ?? location.scripts,
    headers: {...location.headers, ...rule.headers}};
  const lines = [`    location ~ ${pattern} {`];
  if (rule.allow === false) lines.push('        deny all;');
  if (!upstream && fpmHost && rule.scripts === false) lines.push('        location ~ \\.php(/|$) { deny all; }');
  if (rule.expires !== undefined) lines.push(`        expires ${toNginxExpires(rule.expires)};`);
  lines.push(...headers(rule));
  if (rule.allow !== false) {
    const fallback = rule.passthru ? (rule.passthru === true ? passthru : rule.passthru) : null;
    if (upstream) {
      lines.push(fallback ? '        try_files $uri $uri/ @upsun_upstream;' : '        try_files $uri $uri/ =404;');
    } else {
      lines.push(fallback ? `        try_files $uri ${fallback}$is_args$args;` : '        try_files $uri =404;');
    }
  }
  lines.push('    }');
  return lines.map(line => `    ${line}`);
});

/**
 * Render an nginx server block from an application's `web.locations`.
 *
 * Each Upsun location becomes an nginx `location` with its own root, index,
 * passthru (front controller), allow/deny, expires, headers and rules. The
 * document root is `{{LANDO_WEBROOT}}` which Lando's nginx renders at start.
 *
 * @param {import('./config/config.types').RenderingApplication} app Raw or normalized application web settings.
 * @param {string} webroot Webroot relative to /app (already includes sourceRoot).
 * @param {import('./mapping/mapping.types').VhostOptions} [options] Rendering options.
 * @returns {string} nginx server block.
 */
exports.renderVhost = (app, webroot, {upstream = null, fpmHost = 'fpm'} = {}) => {
  const locations = app.web?.locations || {};
  const docroot = '{{LANDO_WEBROOT}}';
  const lines = [
    '# Generated by @lando/upsun from web.locations',
    'server {',
    '    listen 80;',
    '    listen [::]:80 default ipv6only=on;',
    '    server_name localhost;',
    '    client_max_body_size 100M;',
    `    root ${quote(docroot)};`,
    `    index ${upstream || !fpmHost ? 'index.html' : 'index.php index.html'};`,
    '',
  ];

  const entries = Object.entries(locations).sort(([a], [b]) => b.length - a.length);
  for (const [prefix, location] of entries) {
    if (!/^\/[^\s{};#"']*$/.test(prefix)) {
      throw new Error(`web.locations["${prefix}"].prefix contains characters nginx config cannot accept: ${prefix}`);
    }
    validateLocation(prefix, location);
    // Upsun roots are app-relative; compute the offset so nginx alias can re-anchor under the webroot.
    const sourceRoot = app.sourceRoot || '';
    const root = path.join(sourceRoot, (location.root || '').replace(/^\/+/, ''));
    const relative = path.relative(sourceRoot || '.', root);
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
      throw new Error(`web.locations["${prefix}"].root escapes application source root: ${location.root}`);
    }
    const locRoot = location.root ? path.relative(webroot, root) : '';
    const passthru = location.passthru === true ?
      (fpmHost ? '/index.php' : '/index.html') : (location.passthru || null);
    const index = Array.isArray(location.index) && location.index.length ? location.index : null;
    const scriptsOff = location.scripts === false;
    const allowOff = location.allow === false;

    // ^~ makes nested locations (scripts: false) win over the server-level php handler
    lines.push(`    location ${scriptsOff ? '^~ ' : ''}${prefix} {`);
    if (locRoot && locRoot !== '.') lines.push(`        alias ${quote(`${docroot}/${locRoot}`)};`);
    if (index) lines.push(`        index ${index.join(' ')};`);
    if (location.expires !== undefined) lines.push(`        expires ${toNginxExpires(location.expires)};`);
    lines.push(...headers(location));
    if (!upstream && fpmHost && scriptsOff) lines.push('        location ~ \\.php(/|$) { deny all; }');
    if (allowOff && !passthru) {
      lines.push('        deny all;');
    } else if (allowOff) {
      // Static files are denied except via rules; everything goes to the front controller
      lines.push(upstream ? '        try_files /dev/null @upsun_upstream;' :
        `        try_files /dev/null ${passthru}$is_args$args;`);
    } else if (passthru) {
      lines.push(upstream ? '        try_files $uri $uri/ @upsun_upstream;' :
        `        try_files $uri $uri/ ${passthru}$is_args$args;`);
    } else {
      lines.push('        try_files $uri $uri/ =404;');
    }
    lines.push(...rules(location, passthru, upstream, fpmHost));
    lines.push('    }');
    lines.push('');
  }

  if (entries.length === 0) {
    lines.push('    location / {', upstream ? '        try_files $uri $uri/ @upsun_upstream;' :
      `        try_files $uri $uri/ /index.${fpmHost ? 'php' : 'html'}$is_args$args;`, '    }', '');
  }

  lines.push(...(upstream ? proxy(upstream) : fpmHost ? php(fpmHost) : []), '}', '');
  return lines.join('\n');
};
