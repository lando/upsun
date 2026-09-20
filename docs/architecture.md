---
title: Architecture
description: How the Lando Upsun plugin turns Upsun configuration into a local Lando app.
---

# Architecture

This page is the contract between the plugin's modules. If you change a shape
described here, update this page in the same PR.

## Decisions

### 1. Run on Lando's own service plugins, not Platform.sh images

`docker.registry.platform.sh/<type>-<version>:stable` still serves images (the
`:latest` tag the 0.x plugin pulled froze in 2021), but the registry is
undocumented, amd64-only, and was **frozen in August 2024**
(newest: PHP 8.3, Node 20, MariaDB 11.4, PostgreSQL 16, Redis 7.2). Nothing
Upsun added since (PHP 8.4/8.5, Node 22+, Valkey, MariaDB 11.8+, PostgreSQL 17+,
ClickHouse, Gotenberg) exists there, and Upsun Flex runs on Nix-built images
that are not published as containers at all.

So the plugin **translates** Upsun configuration into standard Lando 3 services
(`php`, `node`, `python`, `ruby`, `go`, `mariadb`, `mysql`, `postgres`, `redis`,
`memcached`, `mongo`, `solr`, `elasticsearch`, `varnish`, …) and **emulates the
Upsun runtime contract** (env vars, relationships, routes, mounts, hooks) on top
of them. This is the same approach `ddev-upsun` takes. It gives us current
versions, ARM support, and removes the privileged containers, fake RPC agent and
OPEN protocol the 0.x plugin needed.

### 2. Flex first, Fixed supported

- **Upsun Flex** (`.upsun/*.yaml`) is the primary target.
- **Upsun Fixed** (`.platform.app.yaml`, `.platform/{services,routes,applications}.yaml`)
  is loaded into the same internal model. Fixed is not sold to new customers but
  existing projects are numerous.
- A repo containing **both** is an error, matching Upsun's own behaviour.

### 3. CLI

`upsun` CLI + `UPSUN_CLI_TOKEN` for Flex, `platform` CLI + `PLATFORMSH_CLI_TOKEN`
for Fixed. Resolution lives in one place (`lib/cli.js`). The CLI runs **inside
the app container** so `lando upsun ...` works without a host install, and
`PLATFORM_RELATIONSHIPS`/`PLATFORM_APPLICATION` are stripped from its environment
so it never believes it is running on Upsun.

### 4. Layout (Lando 3 legacy plugin, pantheon-style)

```
index.js            lando-level hooks (ssh/tooling wrappers)
app.js              app-level hooks (load model, warnings, info)
plugin.yml          legacy: true + docs metadata
builders/upsun.js   the `upsun` recipe (_recipe) — model -> lando services/proxy/tooling
inits/upsun.js      `lando init --source upsun`
lib/config/         loaders -> Model (pure)
lib/env.js          Model -> environment variables (pure)
lib/mapping/        Model app/service -> Lando service definitions (pure)
lib/routes.js       Model routes -> Lando proxy (pure)
lib/tooling.js      Model -> tooling definitions
lib/cli.js          upsun vs platform CLI + token resolution
lib/pull.js lib/push.js
utils/              small pure helpers
scripts/            shell helpers mounted at /helpers
config/             templates (nginx locations, php.ini)
test/               mocha + chai unit tests (lib/, utils/)
examples/           leia integration apps
```

Everything under `lib/config`, `lib/env.js`, `lib/mapping`, `lib/routes.js` is
**pure** (no Lando objects, no I/O beyond reading the project's YAML) and fully
unit tested. `builders/`, `app.js`, `index.js` only glue.

### Implementation notes (verified live)

- Env is injected via each app service's `overrides.environment`; Lando has no
  separate build-time env, so build hooks see the runtime contract too.
- PHP apps run `via: nginx`, so the proxy targets the `<app>_nginx` sidecar on
  port 80; other runtimes are proxied on `<app>:8888`. The nginx vhost is
  rendered from `web.locations` by `lib/nginx.js` (Lando's default vhost has no
  front-controller passthru) and passed as `config.vhosts`.
- Tooling commands are prefixed with `/helpers/upsun-exec.sh`, which sources the
  app's `.environment` before exec. `lando ssh` is wrapped the same way and its
  default service is forced to the closest app (`app._defaultService` on
  `ready` @0, before core bakes the ssh default at `ready` @1).
- `build.flavor` runs before `hooks.build` (`composer install` for PHP,
  `npm install` for Node) like Upsun does.
- Lando's `postgres` plugin only supports the passwordless `postgres` superuser,
  so PostgreSQL relationships report `username: postgres`, `password: ''`.
- Mounts are created with `mkdir -p` inside `/app` on every start (`run_internal`);
  they are plain host directories, not separate volumes.

## The Model

`lib/config/index.js` exports `load(root, {domain})` which returns:

```js
{
  flavor: 'flex' | 'fixed',
  root: '/abs/path/to/project',
  configFiles: ['/abs/.upsun/config.yaml', ...],     // what was read
  applications: {
    [name]: {
      name: 'app',
      sourceRoot: 'relative/dir',                    // Flex source.root / Fixed app dir; '' = project root
      type: {runtime: 'php', version: '8.4'},        // composable => primary runtime, see below
      composable: null | {channel: '26.05', runtimes: {php: '8.4', nodejs: '22'}, packages: [...]},
      container_profile: 'BALANCED' | null,
      relationships: {
        [relName]: {service: 'db', endpoint: 'mysql'}   // all three Upsun forms normalized
      },
      mounts: {
        '/web/sites/default/files': {source: 'storage'|'local'|'instance'|'service'|'tmp', source_path: 'files', service: null}
      },
      web: {
        locations: {'/': {root: 'web', passthru: '/index.php', index: [...], scripts: true, allow: true, rules: {}, expires: -1, headers: {}}},
        commands: {pre_start: null, start: null},
        upstream: {socket_family: 'tcp'|'unix', protocol: 'http'|'fastcgi'|null},
        document_root: 'web'                          // derived: root of the most specific '/' location, or ''
      },
      hooks: {build: '', deploy: '', post_deploy: ''},
      crons: {[name]: {spec: '*/5 * * * *', commands: {start: '...'}}},
      workers: {[name]: {commands: {start: '...'}, relationships: {...}, mounts: {...}}},
      variables: {env: {...}, php: {...}, ...},        // raw `variables:` block
      dependencies: {php: {...}, nodejs: {...}, python: {...}},
      runtime: {extensions: [...], disabled_extensions: [...], ...},
      build: {flavor: 'composer'|'none'|...},
      timezone: null,
      raw: {...}                                       // untouched application block
    }
  },
  services: {
    [name]: {
      name: 'db',
      type: {service: 'mariadb', version: '11.4'},
      configuration: {...},                            // raw configuration block (schemas, endpoints, etc.)
      raw: {...}
    }
  },
  routes: {
    ['https://{default}/']: {
      type: 'upstream'|'redirect',
      upstream: 'app:http' | null,                     // app name is split by the consumer
      to: 'https://{default}/' | null,
      primary: true|false,                             // exactly one primary after normalization
      id: null | 'main',
      cache: {...}, ssi: {...}, redirects: {...}, tls: {...},
      raw: {...}
    }
  },
  warnings: [{code: 'composable-runtime-picked', message: '...', data: {...}}]
}
```

Rules:

- **Relationships** accept `db:` (null shorthand → service `db`, default endpoint),
  `{service, endpoint}`, and legacy `"db:mysql"`. Default endpoint per service type
  lives in `lib/config/relationships.js` (`mariadb`/`mysql`/`oracle-mysql` →
  `mysql`, `postgresql` → `postgresql`, `redis` → `redis`, `valkey` → `valkey`,
  `opensearch` → `opensearch`, `elasticsearch` → `elasticsearch`, `solr` → `solr`,
  `memcached` → `memcached`, `mongodb` → `mongodb`, `rabbitmq` → `rabbitmq`,
  `kafka` → `kafka`, `influxdb` → `influxdb`, `varnish` → `http`,
  `chrome-headless` → `http`, `network-storage` → the mount name).
- **Composable images** (`type: composable:<channel>`): pick the primary runtime
  in this order — `php`, `nodejs`, `python`, `ruby`, `golang`, `java`, `elixir`;
  record a `composable-runtime-picked` warning naming the runtime(s) not emulated.
- **Fixed `disk`/`size`** are parsed but ignored; Flex has neither.
- **Route `{default}`** is left as-is in the model; `lib/routes.js` substitutes.
- **Multi-app**: every `applications.<name>` (Flex) or every
  `.platform.app.yaml`/`applications.yaml` entry (Fixed) becomes a model app.
- Unknown keys are preserved on `raw`; the loaders never throw on unknown keys.

`lib/config/detect.js` exports `detect(root)` → `{flavor, files}` and throws
`UPSUN_MIXED_CONFIG` if both flavors are present, `UPSUN_NO_CONFIG` if neither.

## Environment contract

`lib/env.js` exports:

```js
getBuildEnv(model, appName, opts)     // vars available during build hooks
getRuntimeEnv(model, appName, opts)   // vars available to the running app
getRelationshipsPayload(model, appName, opts) // decoded PLATFORM_RELATIONSHIPS object
getServiceEnv(model, appName, opts)   // <RELNAME>_HOST etc.
getRoutesPayload(model, appName, opts) // decoded PLATFORM_ROUTES object
getApplicationPayload(model, appName) // decoded PLATFORM_APPLICATION object
resolveRouteUrl(url, appName, domain) // shared placeholder substitution
entropy(seed)                        // stable local salt
```

`opts` = `{domain, projectId, branch, treeId, entropy, environment, smtpHost, vendor, hostMap}`.
Defaults are `domain: 'lndo.site'`, `projectId: 'lando'`, `branch: 'main'`,
`environment: 'lando'`, `smtpHost: ''`, and vendor derived from `model.flavor`.
`treeId` defaults to the hexadecimal SHA-1 of the UTF-8 app name. `entropy`
defaults to the first 56 hexadecimal characters of SHA-256 of the UTF-8 app
name: stable lowercase alphanumeric text, not a cryptographic secret.
No Git, filesystem, or Lando lookup happens here; callers supply overrides.

`hostMap` maps model service names to mapping-owned connection details:

```js
{host: 'db', ip: '10.0.0.2', port: 3306, scheme: 'mysql',
 username: 'upsun', password: 'upsun', path: 'main', query: {is_master: true}}
```

`host` and `scheme` are strings; `port` is a number. `ip`, `username`,
`password`, `path`, and `query` are optional. Credential/path fields, when
present, are strings. Omit them for credential-less services. `host` is the
plain Lando service hostname; omitted `ip` falls back to `host`. `query` is
reserved mapping metadata: env emits `{is_master: true}` for database types
(`mariadb`, `mysql`, `oracle-mysql`, `postgresql`, `mongodb`, `influxdb`,
`clickhouse`) and `{}` otherwise, regardless of mapping query metadata.
Runtime relationship generation requires a hostMap entry for every referenced
service and throws a descriptive error if one is missing. Builds need no hostMap.
Services with configured endpoints also expose `<service>#<endpoint>` keys.
Relationship consumers use that key when an endpoint is explicit and the plain
service key otherwise.

All output objects have recursively sorted keys; arrays preserve their order.
Base64 payloads use `Buffer.from(JSON.stringify(obj)).toString('base64')`.
`PLATFORM_APPLICATION` preserves the app's `raw` block with normalized `name`
and without `source`. Returned payloads do not share mutable objects with the Model.

Runtime env always contains:

| Var | Value |
|---|---|
| `PLATFORM_APP_DIR` | `/app/<sourceRoot>` |
| `PLATFORM_APPLICATION` | base64 JSON of the app block (Upsun shape) |
| `PLATFORM_APPLICATION_NAME` | app name |
| `PLATFORM_BRANCH` | current git branch or `main` |
| `PLATFORM_DOCUMENT_ROOT` | `/app/<sourceRoot>/<web.document_root>` |
| `PLATFORM_ENVIRONMENT` | `lando` |
| `PLATFORM_ENVIRONMENT_TYPE` | `development` |
| `PLATFORM_PROJECT` | `config.id` from the Landofile, else `lando` |
| `PLATFORM_PROJECT_ENTROPY` | stable 56-char hash derived from the app name |
| `PLATFORM_RELATIONSHIPS` | base64 JSON, see below |
| `PLATFORM_ROUTES` | base64 JSON keyed by resolved local URL |
| `PLATFORM_SMTP_HOST` | `mailpit` if a mail service exists, else `` |
| `PLATFORM_TREE_ID` | git HEAD tree hash or a stable fake |
| `PLATFORM_VARIABLES` | base64 JSON of `variables.*` minus the `env:` group |
| `PLATFORM_VENDOR` | `upsun` (flex) or `platformsh` (fixed) |
| `PORT` | `8888` |
| `SOCKET` | `/run/app.sock` (only when `upstream.socket_family: unix`) |
| `<KEY>` | every `variables.env.<key>` |

Build env is the build-time subset (`PLATFORM_APP_DIR`, `PLATFORM_APPLICATION`,
`PLATFORM_APPLICATION_NAME`, `PLATFORM_CACHE_DIR=/tmp/cache`,
`PLATFORM_OUTPUT_DIR`, `PLATFORM_PROJECT`, `PLATFORM_PROJECT_ENTROPY`,
`PLATFORM_TREE_ID`, `PLATFORM_VARIABLES`, `PLATFORM_VENDOR`, `CI=lando`).
`PLATFORM_OUTPUT_DIR` equals `PLATFORM_APP_DIR`. Paths use POSIX joins, with
empty `sourceRoot` producing `/app`. Build and runtime both promote
`variables.env.<key>` unchanged by name, serializing complex values as JSON.
Generated variables take precedence over application variables.
`PLATFORM_VARIABLES` excludes `env` and flattens one namespace level:
`variables.php.memory_limit` becomes `php:memory_limit`, while nested values
remain JSON objects or arrays. The same application payload is used in both
phases; this local contract does not emulate Upsun's build-time attribute filtering.

Route payloads include every Model route. Keys and redirect `to` values resolve
`{default}` and `{all}` using the supplied `appName` and domain; literal hosts
are unchanged. Values contain `type`, `upstream`, `to`, `primary`, `id`,
`original_url` (the original Model key), `attributes: {}`, `tls`, `cache`,
`ssi`, `redirects`, and `http_access` (normalized field, else `raw.http_access`,
else `{}`). Redirects remain redirects in this payload. Primary flags are not
recomputed. If two keys resolve to the same URL, the lexically later Model key
wins. Proxy generation remains the responsibility of `lib/routes.js`.

`PLATFORM_RELATIONSHIPS` entry shape (one array element per relationship):

```json
{"database": [{
  "service": "db", "rel": "mysql", "type": "mariadb:11.4", "cluster": "lando",
  "scheme": "mysql", "host": "db", "hostname": "db", "ip": "…", "port": 3306,
  "username": "upsun", "password": "upsun", "path": "main", "query": {"is_master": true},
  "fragment": null, "public": false, "host_mapped": false, "epoch": 0, "instance_ips": []
}]}
```

Credentials are fixed and predictable per service type (user/pass `upsun`,
database `main`, or whatever the Upsun service `configuration.schemas`/
`endpoints` declares). Redis/Valkey/Memcached/Solr/OpenSearch carry no
credentials. `lib/mapping` decides the Lando service creds and `lib/env` reads
them from `hostMap`.

Service env vars: for every relationship `name`, emit `NAME_<FIELD>` for
`HOST HOSTNAME IP PORT SCHEME USERNAME PASSWORD PATH TYPE SERVICE REL CLUSTER
QUERY URL INSTANCE_IPS EPOCH PUBLIC HOST_MAPPED FRAGMENT NAME`.
`URL` = `scheme://user:pass@host:port/path`, omitting authentication when no
username exists and omitting `/path` when path is absent. Credentials and path
segments are URI-encoded. `QUERY` and `INSTANCE_IPS` are JSON; booleans and
numbers are strings; `FRAGMENT` is an empty string. `NAME` aliases `PATH`.
Absent optional credential/path fields (including `NAME`) are not emitted.
`name` is upper-cased with non-alphanumerics replaced by `_`.

Field names were checked against the live [service environment variables](https://docs.upsun.com/development/variables.md#service-environment-variables),
[variable usage](https://docs.upsun.com/development/variables/use-variables.md), and
[relationship configuration](https://docs.upsun.com/create-apps/image-properties/relationships.md) docs.
The [MariaDB](https://docs.upsun.com/add-services/mysql.md) and
[PostgreSQL](https://docs.upsun.com/add-services/postgresql.md) payload examples use
`path`, not `name`; `NAME` is a service-env alias only. Published Redis and
OpenSearch examples use null credentials and array queries, and Memcached shows
a reduced field set. This local contract deliberately omits absent credentials
and uses object queries plus the common metadata above for every service.

## Mapping contract

`lib/mapping/index.js` exports:

```js
mapApplication(app, model, opts) // -> {services: {[landoServiceName]: landoServiceDef}, warnings}
mapService(service, model, opts) // -> {services, volumes?, hostMap, warnings}
```

- The app's Lando service is named after the model app (`app` → `app`).
  PHP apps use `type: php:<v>` with `via: nginx`, `webroot` from
  `web.document_root`, `composer_version` from
  `dependencies.php.composer/composer` or `build.flavor`, and `xdebug` from the
  Landofile. Node/Python/Ruby/Go apps use their Lando service with
  `command: <web.commands.start>` and `port: 8888`.
- Versions: exact match if Lando supports it, otherwise nearest **lower** minor
  in the same major (warning `version-fallback`), otherwise the newest supported
  (warning `version-unsupported`).
- Service types not backed by a bundled Lando plugin (`rabbitmq`, `kafka`,
  `influxdb`, `chrome-headless`, `opensearch`, `valkey`, `network-storage`,
  `vault-kms`, `gotenberg`, `clickhouse`) use a `compose`-type Lando service with
  an official upstream image (`opensearchproject/opensearch`, `valkey/valkey`,
  `rabbitmq:<v>-management`, `apache/kafka`, `influxdb`,
  `gotenberg/gotenberg`, `clickhouse/clickhouse-server`, `chromedp/headless-shell`)
  and the ports Upsun exposes. Compose image configuration is the Docker service
  body directly under the Lando definition's `services` key. `chrome-headless`
  uses `chromedp/headless-shell` because it exposes the native DevTools port 9222.
  `network-storage` returns a top-level named volume declaration shared into every
  app that mounts it.
- Every mount becomes a Lando volume: `storage`/`local`/`instance` → named volume
  `upsun-<app>-<slug>`; `service` → the network-storage volume; `tmp` → Compose
  long syntax `{type: 'tmpfs', target: <container-path>}`.
- SQL services with configured endpoints expose both a plain service `hostMap`
  entry for the endpoint selected by a model relationship and one
  `<service>#<endpoint>` entry per endpoint. MariaDB paths come from
  `default_schema`; PostgreSQL paths come from `default_database`.
- Hooks: `hooks.build` → `build` step; `hooks.deploy` + `hooks.post_deploy` →
  `run` steps, executed via `/helpers/upsun-hook.sh <name>` which sources the
  app's `.environment` and the runtime env first.
- `crons` are exposed as `lando cron <name>` tooling, never scheduled.
- `workers` become extra Lando services cloned from the app definition with
  `command: <worker.commands.start>`.

## Routes contract

`lib/routes.js` exports `getProxyConfig(model, domain)` → Lando `proxy:` block
and `resolveRoutes(model, domain)` → `{[localUrl]: routeInfo}` used for
`PLATFORM_ROUTES`. `{default}` → `<appname>.<domain>`, `{all}` expands to the
default only, subdomains are preserved (`www.{default}` → `www.<appname>.<domain>`).
Redirect routes become Lando proxy entries pointing at the upstream target with a
`redirect-route` warning (Lando's proxy cannot 301).

## Testing

- Unit: `npm run test:unit` — every pure module has fixtures under
  `test/fixtures/{flex,fixed}/*` mirroring real Upsun templates.
- Integration: `npm run test:leia` — small matrix in `examples/`
  (`flex-php`, `fixed-php`; node and multi-app examples to follow), each README
  is a Leia test.
- CI: unit on ubuntu/macos/windows × Node 20; Leia × `3-stable`/`3-edge`.

## CLI & sync

`lib/cli.js`:

```js
resolveCli(flavor)           // {binary, tokenVar, home, vendor}
getCliEnv(flavor, {token, projectId, environment}) // tooling env: <tokenVar>, <VENDOR>_CLI_NO_INTERACTION=1,
                                                    // PLATFORM_RELATIONSHIPS='' and PLATFORM_APPLICATION='' (never "in the cloud")
getInstallStep(flavor)       // root build step: /helpers/upsun-install-cli.sh <binary> (GitHub release tarball -> /usr/local/bin)
```

The recipe builder wires, for the closest app service `<app>`:

| Tooling | Task | Runs in |
|---|---|---|
| `lando upsun <cmd>` / `lando platform <cmd>` | `{service: <app>, cmd: <binary>, env: getCliEnv(...)}` | app |
| `lando pull` | `lib/pull.getPullTask(model, app, cli, tokens)` → `/helpers/upsun-pull.sh` | app |
| `lando push` | `lib/push.getPushTask(model, app, cli, tokens)` → `/helpers/upsun-push.sh` | app |
| `lando cron <name>` | `{service: <app>, cmd: '/helpers/upsun-cron.sh <name>'}` per `crons` entry | app |

Where `cli = {...resolveCli(flavor), projectId: landofile.config.id, environment: <branch>}`.
Both sync tasks have `level: 'app'`, target `service: <app>`, and expose passthrough
`--auth`, `--project`, `--env`, `--relationship/-r`, and `--mount/-m` options.
Relationship choices contain only SQL relationships; mount choices come from
`Object.keys(app.mounts)`. Push also exposes `--force`.

App service build steps added by the builder:

- `build_as_root`: for Node and other non-PHP app services, append
  `lib/pull.getPullBuildSteps()` to install `mariadb-client` and
  `postgresql-client`. Standard `devwithlando/php` images already ship
  `mysql`/`mariadb`, `mysqldump`, `psql`, and `pg_dump`; official `node` images
  ship none of them.
- `build`: run `getInstallStep(flavor)` as the app user, then
  `/helpers/upsun-hook.sh build`.
- `run`: `/helpers/upsun-hook.sh deploy`, `/helpers/upsun-hook.sh post_deploy` (when defined).

Scripts (mounted at `/helpers`):

- `upsun-hook.sh <build|deploy|post_deploy>` — reads the hook body from
  `PLATFORM_APPLICATION`, sources `.environment`, and runs in `PLATFORM_APP_DIR`.
- `upsun-env.sh` — sourced by tooling wrappers; exports `PLATFORM_*` and sources `.environment`.
- `upsun-pull.sh` / `upsun-push.sh` — expect `UPSUN_CLI_BINARY`, `UPSUN_CLI_TOKEN_VAR`,
  `PLATFORM_PROJECT`, and the `<REL>_HOST/_PORT/_USERNAME/_PASSWORD/_PATH/_SCHEME` service env
  vars for the local import target. Use `<cli> db:dump` / `mount:download` and `db:sql` /
  `mount:upload`; push refuses the production environment unless `--force`.
- `upsun-sync-env.sh` — shared arg parsing and paused/inactive environment resume.
`inits/upsun.js` registers `lando init --source upsun` (Flex, `upsun` CLI) and `--source platformsh`
(Fixed, `platform` CLI). Its init-container clone step runs `getInstallStep(flavor)`,
adds `~/.local/bin` to `PATH`, and calls `<cli> get <project-id> /app`. Both
sources write `recipe: upsun` and `config.id`. Project listing uses
`platformsh-client` with `api_url: https://api.upsun.com` and
`authentication_url: https://auth.upsun.com`; token caches are `upsun.tokens`
and `platformsh.tokens` per vendor.
