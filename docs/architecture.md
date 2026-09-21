---
title: Architecture
description: How the Lando Upsun plugin turns Upsun configuration into a local Lando app.
---

# Architecture

This page is the contract between the plugin's modules. Update it when a model,
mapping, environment or lifecycle shape changes.

## Decisions

### Translate onto Lando services

The plugin translates Upsun configuration into standard Lando 3 services and
official images. It emulates the runtime contract rather than running Upsun's
production images. This keeps runtime versions current, supports ARM hosts, and
removes the privileged containers, fake RPC agent and OPEN protocol the 0.x
plugin needed.

Flex (`.upsun/*.yaml`) and Fixed (`.platform*`) load into the same model. A
repository containing both formats is rejected.

### Keep provider details at the edges

`lib/config`, `lib/env.js`, `lib/mapping`, `lib/routes.js`, `lib/hooks.js` and
`lib/tooling.js` produce plain objects. `builders/upsun.js` assembles those
objects into Lando configuration; `app.js` handles Lando events.

```text
lib/config/           project YAML -> normalized model
lib/env.js            model -> runtime and service environment
lib/mapping/          apps/services -> Lando definitions
lib/routes.js         routes -> proxy entries and middlewares
lib/hooks.js          model -> ordered every-start commands
lib/tooling.js        model -> tooling definitions
builders/upsun.js     Lando-facing assembly
app.js                warnings, info and post-start execution
scripts/              helpers mounted at /helpers
```

### Implementation notes verified live

- Environment is merged into each non-nginx service's
  `overrides.environment`; mapping-provided values such as a worker's
  `PLATFORM_APP_COMMAND` win.
- PHP apps proxy to `<app>_nginx:80`. Non-PHP apps with `web.locations` also use
  `<app>_nginx:80`; other non-PHP apps proxy to `<app>:8888`.
- Mounts are `mkdir -p` commands. No mapping emits volumes.
- Lando lock-gates configured `run_*` steps, so `config.run` runs once per
  rebuild. The plugin dispatches mounts, tether, database initialization and
  lifecycle hooks from `post-start` priority 101 on every start.
- PostgreSQL endpoint users are created with password `upsun`; the default
  endpoint user is `upsun`.
- Tooling and the SSH wrapper use `/helpers/upsun-exec.sh` to source the tether
  environment and application `.environment` file.

## Model contract

`lib/config/index.js` exports `load(root)`:

```js
{
  flavor: 'flex' | 'fixed',
  root: '/absolute/project',
  configFiles: [],
  applications: {
    app: {
      name: 'app',
      sourceRoot: '',
      type: {runtime: 'php', version: '8.4'},
      composable: null | {
        channel: '26.05',
        runtimes: [{runtime: 'php', version: '8.4', options: {}}],
        packages: ['jq'],
      },
      relationships: {database: {service: 'db', endpoint: 'mysql'}},
      mounts: {'/files': {source: 'local', source_path: '', service: null}},
      web: {
        locations: {},
        commands: {pre_start: null, start: null, post_start: null},
        upstream: {socket_family: 'tcp', protocol: null},
        document_root: '',
      },
      hooks: {build: '', deploy: '', post_deploy: ''},
      crons: {},
      workers: {},
      operations: {},
      additional_hosts: {},
      variables: {env: {}},
      dependencies: {},
      runtime: {extensions: [], disabled_extensions: []},
      build: {},
      timezone: null,
      raw: {},
    },
  },
  services: {
    db: {name: 'db', type: {service: 'mariadb', version: '11.4'}, configuration: {}, raw: {}},
  },
  routes: {},
  warnings: [],
}
```

Composable `stack.runtimes` preserves declared order and the first entry is the
primary runtime. `stack.packages` remains a string array. PHP composable
extension options merge into `runtime.extensions` and
`runtime.disabled_extensions`. A Node.js runtime after PHP is supported; other
secondary runtimes enter `data.ignored` on `composable-runtime-picked`.

Relationships normalize shorthand, object and legacy string forms. Default
endpoints include `mercure`, `chroma` and `qdrant` as `http`.

## Environment contract

`getRuntimeEnv(model, appName, opts)` accepts:

```js
{
  domain, name, projectId, branch, treeId, entropy, environment,
  smtpHost, vendor, hostMap, tethered, tetherEnvironment,
}
```

The local route host is `${name ?? 'lando'}.${domain ?? 'lndo.site'}`. The
builder passes the Lando app name, not the Upsun application name.

| Variable | Value |
|---|---|
| `PLATFORM_APP_DIR` | `/app/<sourceRoot>` |
| `PLATFORM_APPLICATION` | base64 JSON of the raw app block without `source` |
| `PLATFORM_APPLICATION_NAME` | model application name |
| `PLATFORM_BRANCH` | git branch or `main` |
| `PLATFORM_DOCUMENT_ROOT` | app directory plus `web.document_root` |
| `PLATFORM_ENVIRONMENT` | `lando` by default |
| `PLATFORM_ENVIRONMENT_TYPE` | `development` |
| `PLATFORM_PROJECT` | Landofile ID, local project ID, or `lando` |
| `PLATFORM_PROJECT_ENTROPY` | stable 56-character SHA-256 prefix |
| `PLATFORM_RELATIONSHIPS` | base64 JSON, or an empty string while tethered |
| `PLATFORM_ROUTES` | base64 JSON keyed by resolved local URL |
| `PLATFORM_SMTP_HOST` | `mailpit` by default; empty when mail is disabled |
| `PLATFORM_TREE_ID` | supplied value or SHA-1 of the app name |
| `PLATFORM_VARIABLES` | base64 JSON of non-`env` variables |
| `PLATFORM_VENDOR` | `upsun` for Flex, `platformsh` for Fixed |
| `PLATFORM_APP_COMMAND` | `web.commands.start`, when present |
| `PLATFORM_PRE_APP_COMMAND` | `web.commands.pre_start`, when present |
| `PLATFORM_POST_APP_COMMAND` | `web.commands.post_start`, when present |
| `TZ` | application `timezone`, when present |
| `UPSUN_TETHERED` | `1` in tethered mode |
| `UPSUN_TETHER_ENVIRONMENT` | selected tether environment |
| `PORT` | `8888` |

Each relationship also expands to string-valued `NAME_<FIELD>` variables,
including `HOST`, `PORT`, `USERNAME`, `PASSWORD`, `PATH`, `SCHEME` and `URL`.
Tethered mode omits these until `/tmp/upsun-tether.env` is sourced.

`getCliEnv()` sets the vendor token, no-interaction and update-check variables,
`UPSUN_CLI_CONTEXT=1`, and blanks `PLATFORM_RELATIONSHIPS` /
`PLATFORM_APPLICATION` so CLI calls do not consume local runtime payloads.

## Mapping contract

`mapApplication(app, model, {xdebug, mail, crons, versions})` returns
`{services, warnings}`. Definitions use these internal keys before builder
assembly:

| Role | Name | Command/proxy | Build behaviour |
|---|---|---|---|
| PHP app | `<app>` | PHP via nginx; proxy `<app>_nginx:80` | jq, extensions, root php.ini, optional Node.js, Mailpit ini; dependencies and build hook |
| non-PHP app | `<app>` | `/helpers/upsun-start.sh`; port `8888` | database clients, jq, rsync, SSH; dependencies and build hook |
| worker | `<app>--<worker>` | start wrapper; no proxy | app root setup; no app build steps |
| cron | `<app>--cron` | `/helpers/upsun-crond.sh`; no proxy | app root setup plus Supercronic; no app build steps |
| non-PHP nginx sidecar | `<app>_nginx` | upstream app or static files on port `80` | rendered vhost only |

Every mapped runtime definition carries temporary `upsun` metadata with
`role`, model app, locations, relationships, proxy target and static state.
It also carries `build_as_root` and `build` arrays. The builder consumes those
keys into `build_as_root_internal` / `build_internal` and removes the metadata.

`additional_hosts` becomes `overrides.extra_hosts`. Workers override
`PLATFORM_APP_COMMAND` with their own start command. The cron sidecar is created
only when `config.crons: true` and the app defines crons.

`mapService(service, model, {versions})` returns `{services, hostMap, warnings}`.
Supported version arrays come from installed Lando plugin builder metadata when
available; generated static tables remain the fallback.

SQL mapping also feeds `lib/mapping/database.js`. On every start, the closest
app runs idempotent statements for schemas, endpoint users and privileges. Both
MySQL-family and PostgreSQL users use password `upsun`.

`getMailpitDefinition()` creates service `mailpit`, listens for SMTP on port 25,
and proxies the UI at `mail.<name>.<domain>`. PHP receives a generated
`sendmail_path` targeting `mailpit:25`. `config.mail: false` disables all of it.

## Start commands

`lib/hooks.js` returns `{name, cmd, user}` entries. App commands are ordered:

| Order | Name | User | Condition |
|---|---|---|---|
| 1 | `mounts` | app | mounts exist |
| 2 | `tether` | root | tethered mode |
| 3 | `db-init:<service>` | app | local SQL service; closest app only |
| 4 | `deploy` | app | `hooks.deploy` exists |
| 5 | `pre_start` | app | PHP app with `web.commands.pre_start` |
| 6 | `post_start` | app | `web.commands.post_start` exists |
| 7 | `post_deploy` | app | `hooks.post_deploy` exists |

Workers and cron sidecars receive mount creation only. Non-PHP `pre_start` is
handled by `/helpers/upsun-start.sh` before it executes the app command.

`app.js` converts the arrays into `engine.run()` commands at `post-start`
priority 101. App-user entries resolve to the service `meUser`; root entries stay
root. A failure becomes a Lando warning with `lando restart` as the retry command.

## Routes contract

`getProxyConfig(model, {domain, name}, targets)` returns `{proxy, warnings}`.
Each entry has `hostname`, string `port`, `pathname` and middleware records.
Standard middlewares set `X-Client-IP`, `X-Original-Route` and `X-Client-SSL`.

Redirect routes attach Traefik `redirectregex` middleware to their resolved
upstream target, or the primary target when the destination is external. They
are permanent 301 redirects. `redirects.paths` adds pathname entries or regexp
middleware to the upstream route; `code: 302` sets `permanent=false`.

For a Landofile named `my-project`, `www.{default}` resolves to
`www.my-project.lndo.site` and redirects to the canonical
`my-project.lndo.site` route. Proxy generation returns no redirect warning.

## CLI and sync

`lib/cli.js` exports the frozen `API_CONFIG` with endpoints
`https://api.upsun.com` and `https://auth.upsun.com`. Flex uses `upsun` /
`UPSUN_CLI_TOKEN`; Fixed uses `platform` / `PLATFORMSH_CLI_TOKEN`.

Pull and push expose authentication, environment, project, relationship, mount,
`--skip-db`, `--skip-files` and `-A/--app` options. Pull also exposes
`--all-mounts`; push adds `--force`. Pull downloads gzip dumps and streams them
into the local client. Tethered sync skips databases with a warning.

Tether tooling runs as root and receives the CLI environment. It opens remote
relationship tunnels, while `UPSUN_CLI_CONTEXT=1` prevents recursive loading of
the generated tether environment.

## Helper scripts

| Script | Arguments | Main configuration |
|---|---|---|
| `upsun-env.sh` | sourced | `UPSUN_TETHER_ENV_FILE` (`/tmp/upsun-tether.env`), `UPSUN_CLI_CONTEXT` (skip the tether file when `1`), `PLATFORM_APP_DIR` |
| `upsun-exec.sh` | command and arguments | sources `upsun-env.sh`, then `exec` |
| `upsun-start.sh` | none | `UPSUN_ENV_HELPER`, `UPSUN_TETHERED`, `UPSUN_TETHER_ENV_FILE`, `UPSUN_TETHER_TIMEOUT` (120), `PLATFORM_APP_DIR`, `PLATFORM_PRE_APP_COMMAND`, `PLATFORM_APP_COMMAND` |
| `upsun-hook.sh` | `build`, `deploy`, `post_deploy`, `pre_start`, `post_start` | `PLATFORM_APPLICATION`, `PLATFORM_APP_DIR` |
| `upsun-operation.sh` | operation name | `PLATFORM_APPLICATION`, `PLATFORM_APP_DIR` |
| `upsun-cron.sh` | cron name | `PLATFORM_APPLICATION`, `PLATFORM_APP_DIR` |
| `upsun-crond.sh` | none | `PLATFORM_APPLICATION`, `UPSUN_CRONTAB` (`/tmp/crontab`), `UPSUN_SUPERCRONIC`, `UPSUN_CRON_SCRIPT` |
| `upsun-php-extensions.sh` | `--enable a,b --disable c` | `UPSUN_PHP_BIN`, `UPSUN_PHP_EXT_INSTALLER`, `UPSUN_PHP_CONF_DIR` |
| `upsun-xdebug.sh` | `on [mode]`, `off` | `UPSUN_PHP_CONF_DIR`, `UPSUN_FPM_POOL_DIR`, `UPSUN_PHP_EXT_ENABLE`, `UPSUN_PGREP`, `UPSUN_KILL` |
| `upsun-db-init.sh` | host, `mysql`/`pgsql`, base64 SQL | `UPSUN_DB_WAIT` (60), `UPSUN_MYSQL_CLIENT`, `UPSUN_PSQL_CLIENT`; exits 4 on timeout |
| `upsun-install-supercronic.sh` | none | `SUPERCRONIC_VERSION`, `UPSUN_CURL`, `UPSUN_INSTALL_DIR` |
| `upsun-install-node.sh` | major version | `UPSUN_CURL`, `UPSUN_NODE_PREFIX`, `UPSUN_NODE_BIN`, `UPSUN_NODE_DIST` |
| `upsun-install-cli.sh` | `upsun`/`platform`, optional version | `UPSUN_CLI_INSTALL_DIR` |
| `upsun-tether.sh` | `open`, `--close`, `--info` | `UPSUN_CLI_BINARY`, `UPSUN_CLI_TOKEN_VAR`, `PLATFORM_PROJECT`, `PLATFORM_APPLICATION_NAME`, `UPSUN_TETHER_ENVIRONMENT`, `UPSUN_TETHER_DIR`, `UPSUN_TETHER_ENV_FILE`, `UPSUN_FPM_POOL_DIR`, `UPSUN_TETHER_BASE_PORT` (30000), `UPSUN_TETHER_WAIT` (30) |
| `upsun-pull.sh`, `upsun-push.sh` | sync flags, plus `--all-mounts`, `--skip-db`, `--skip-files`, `-A/--app` where supported | `UPSUN_TETHERED` skips databases; `PLATFORM_APPLICATION_NAME` defaults `-A` |
| `upsun-sync-env.sh` | sourced | shared sync argument parsing, project binding and environment activation |

Generated files include `/tmp/upsun-tether.env`, tunnel PID/log files under
`/run/upsun-tether`, `/tmp/crontab`, PHP-FPM pool fragments for tether/Xdebug,
and PHP ini fragments for app config, Xdebug and Mailpit.

## Testing

- Model/env/routes: `config-load.spec.js`, `config-relationships.spec.js`,
  `env.spec.js`, `routes.spec.js`.
- Mapping: `mapping-applications.spec.js`, `mapping-php.spec.js`,
  `mapping-services.spec.js`, `mapping-database.spec.js`,
  `mapping-versions.spec.js`, `nginx.spec.js`.
- Lifecycle scripts: `hooks.spec.js`, `start.spec.js`, `hook.spec.js`,
  `operation.spec.js`, `crond.spec.js`, `db-init.spec.js`, `installers.spec.js`,
  `php-scripts.spec.js`, `tether.spec.js`.
- Sync: `pull.spec.js`, `push.spec.js`, `sync.spec.js`, `sync-native.spec.js`,
  with `mock-platform.sh`, `mock-db-client.sh` and `sync-harness.sh` fixtures.
- Glue: `builder.spec.js`, `app.spec.js`, `init.spec.js`, `project.spec.js`.
- Integration examples are Leia READMEs. Host-side script tests require Bash and
  `jq`.
