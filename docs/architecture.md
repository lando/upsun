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
scripts/              namespaced container helpers mounted at /helpers
dev/                  host-only maintainer scripts (excluded from npm)
```

### Implementation notes verified live

- Environment is merged into each non-nginx service's
  `overrides.environment`; mapping-provided values such as a worker's
  `PLATFORM_APP_COMMAND` win.
- PHP apps proxy to `<app>_nginx:80`. Non-PHP apps with `web.locations` also use
  `<app>_nginx:80`; other non-PHP apps proxy to `<app>:8888`.
- App mounts are `mkdir -p` commands. `valkey-persistent` maps a named `data_<name>` volume to `/data` and enables `--appendonly yes`.
- Lando lock-gates configured `run_*` steps, so `config.run` runs once per
  rebuild. The plugin dispatches mounts, database initialization and
  lifecycle hooks from `post-start` priority 101 on every start.
- PostgreSQL endpoint users are created with password `upsun`; the default
  endpoint user is `upsun`.
- Tooling and the SSH wrapper use `/helpers/upsun-exec.sh` to source the
  application `.environment` file.
- Lando's `compose` service type replaces the image `ENTRYPOINT` with its own
  entrypoint and drops `CMD`, so every compose-backed service (OpenSearch,
  RabbitMQ, Kafka, InfluxDB, Valkey and friends) is started with an explicit
  `command` that reproduces the image entrypoint plus command.

## Model contract

`lib/config/index.js` exports `detect(root)` and `load(root, {overrides, variables})`. Overrides
are keyed by application or service name; legacy variables are keyed by
application name. They are merged into the raw YAML with lodash `merge`
before normalization: `variables[app]` becomes
`{variables: ...}` on that app, then `overrides[name]` is merged over the app
or service. Names with no raw target are ignored, arrays merge by index, and
the caller's objects are not mutated. The builder passes
`config.overrides` and `config.variables` from the Landofile; top-level
`services:` is merged over the generated Lando services separately.
Fixed/Adobe Commerce `applications.yaml` accepts lists or name-keyed maps; map keys supply names, and conflicting explicit names are rejected.

`UpsunYaml(baseDir, projectRoot = baseDir)` resolves `!include` and `!archive`
relative to the current YAML file. Both lexical paths and realpaths must stay
inside `projectRoot`; absolute tag paths and symlinks pointing outside it throw
an error naming the offending path. Flex passes the project root separately
from its `.upsun` base directory. Nested includes retain their own file-relative
base directory. Circular includes throw an error showing the include chain.

```js
{
  flavor: 'flex' | 'fixed',
  layout: 'upsun' | 'platform' | 'magento',
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
endpoints include `mercure` as `http`. A relationship
may target another application; the builder resolves it to that app's local
HTTP service through `hostMap` (`{host, port, scheme: 'http'}`).

`layout` is `magento` when `.magento.app.yaml` plus `.magento/services.yaml`
and `.magento/routes.yaml` are detected; mixing layouts throws
`UPSUN_MIXED_CONFIG`.

## Environment contract

`getRuntimeEnv(model, appName, opts)` accepts:

```js
{
  domain, domains, name, projectId, branch, treeId, entropy, environment,
  smtpHost, vendor, hostMap, relationships, omitVariables,
}
```

The local route host is `${name ?? 'lando'}.${domain ?? 'lndo.site'}`. The
builder passes the Lando app name, not the Upsun application name. `domains`
(`config.domains`) adds one `<label>.<name>.<domain>` host per entry;
`lib/domains.js` owns the label rule and `{all}` expansion, and `{default}`
routes win collisions with expanded `{all}` routes.

`omitVariables` lists keys found in Landofile `env_file` entries. Those keys
are dropped from the promoted `variables.env` so Compose's env file value is
used; `KEY=value`, `KEY: value` and bare `KEY` forms are recognized, and `PLATFORM_*` and relationship variables are unaffected.

`relationships` overrides the application's normalized relationship map for a
specific role. The builder passes each role's effective relationships, including
worker additions, to both the base64 payload and expanded relationship variables.
Roles with the same relationship map retain byte-identical relationship payloads
and expanded relationship variables.
Worker mappings override `PLATFORM_APP_COMMAND` with the worker's start command
(or an empty string when absent) and clear `PLATFORM_PRE_APP_COMMAND` and
`PLATFORM_POST_APP_COMMAND`; web commands do not run in workers.
Credential-less services (MongoDB, Valkey, Redis) carry `null` `username`/`password`
in the payload, like Upsun; the expanded `<REL>_USERNAME`/`<REL>_PASSWORD` variables are omitted.

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
| `PLATFORM_RELATIONSHIPS` | base64 JSON |
| `PLATFORM_ROUTES` | base64 JSON keyed by resolved local URL; `upstream` is the application name, `attributes` are preserved, boolean `ssi` becomes `{enabled}` |
| `PLATFORM_SMTP_HOST` | builder passes `mailpit` when mail is enabled and `''` otherwise; the function defaults to `''` |
| `PLATFORM_TREE_ID` | supplied value or SHA-1 of the app name |
| `PLATFORM_VARIABLES` | base64 JSON of non-`env` variables |
| `PLATFORM_VENDOR` | `upsun` for Flex, `platformsh` for Fixed |
| `PLATFORM_APP_COMMAND` | `web.commands.start`, when present |
| `PLATFORM_PRE_APP_COMMAND` | `web.commands.pre_start`, when present |
| `PLATFORM_POST_APP_COMMAND` | `web.commands.post_start`, when present |
| `TZ` | application `timezone`, when present |
| `PORT` | `8888` |
| `SOCKET` | `/run/app.sock` when `web.upstream.socket_family` is `unix` |

Each relationship also expands to string-valued `NAME_<FIELD>` variables,
including `HOST`, `PORT`, `USERNAME`, `PASSWORD`, `PATH`, `SCHEME` and `URL`.
When the endpoint path is null (no default schema/database, or an application
target) `NAME_PATH` is omitted and `NAME_URL` carries no path suffix.

For `layout: magento`, every `PLATFORM_<X>` variable is mirrored as
`MAGENTO_CLOUD_<X>` with the same value.

`getCliEnv()` sets the vendor token, no-interaction and update-check variables,
`UPSUN_CLI_CONTEXT=1`, and blanks `PLATFORM_RELATIONSHIPS` /
`PLATFORM_APPLICATION` so CLI calls do not consume local runtime payloads.

## Mapping contract

`mapApplication(app, model, {xdebug, mail, crons, versions})` returns
`{services, warnings}`. Definitions use these internal keys before builder
assembly:

| Role | Name | Command/proxy | Build behaviour |
|---|---|---|---|
| PHP app | `<app>` | nginx with `fastcgi_pass <app>:9000`; proxy `<app>_nginx:80` | jq, extensions, root php.ini, optional Node.js, Mailpit ini; dependencies and build hook. Generated php.ini carries `xdebug.mode`, `runtime.xdebug.idekey` and `variables.php`; `XDEBUG_MODE` is blanked in the container environment so that ini and `upsun-xdebug.sh` decide the mode |
| non-PHP app | `<app>` | `/helpers/upsun-start.sh`; port `8888` | database clients, jq, rsync, SSH; dependencies and build hook |
| worker | `<app>--<worker>` | start wrapper; no proxy | app root setup; no app build steps |
| cron | `<app>--cron` | `/helpers/upsun-crond.sh`; no proxy | app root setup plus Supercronic; no app build steps |
| non-PHP nginx sidecar | `<app>_nginx` | upstream app or static files on port `80` | rendered vhost only |

Every mapped runtime definition carries temporary `upsun` metadata with
`role`, model app, locations, relationships, proxy target and static state.
It also carries `build_as_root` and `build` arrays. The builder consumes those
keys into `build_as_root_internal` / `build_internal` and removes the metadata.

The Xdebug mode is `config.xdebug` when the Landofile sets it (`true` means
`debug`), otherwise `debug` when the app declares `runtime.xdebug.idekey`, otherwise
`off`. A mode other than `off` is passed to the PHP plugin, which enables the
bundled extension at build; `xdebug` is then left out of the extension step.
`upsun-php-extensions.sh` enables extensions whose `.so` already sits in the
extension directory instead of calling the installer, which refuses to reinstall
them.
`runtime.disabled_extensions: [xdebug]` prevents build-time loading even when an
IDE key or mode is configured; `lando xdebug-on` can still load it explicitly.
`variables.php` settings override the generated mode and IDE key without changing
whether the extension is loaded. On legacy Xdebug 2, `xdebug-off` removes the
bundled extension's ini file because that version does not support `xdebug.mode`.

Automatic Composer/npm build-flavor steps change into `/app/<sourceRoot>` for
nested apps. Dependency arguments and source/mount paths are shell-quoted;
extension names and secondary runtime versions are validated before interpolation.
Generated config filenames accept only `[A-Za-z0-9_.-]+` service names and must
resolve inside the builder's config directory.

nginx location rules are nested regex locations under their prefix parent,
inheriting its alias, `allow`/`scripts` settings and headers unless the rule
overrides them.
Location values are validated before rendering, and each location `root` must stay inside the application's source directory.
Non-PHP applications without a start command use static nginx rendering
(`upstream: null`, `fpmHost: null`). Their passthroughs resolve to local files,
including nested-rule fallbacks, without PHP handlers or an application proxy.

Root apt steps pass `-o Acquire::Retries=3` to both `apt-get update` and
`apt-get install`. apt >= 2.3 already defaults to three retries, but older
Debian-based images default to zero.

`additional_hosts` becomes `overrides.extra_hosts`. Workers override
`PLATFORM_APP_COMMAND` with their own start command. The cron sidecar is created
only when `config.crons: true` and the app defines crons.

`mapService(service, model, {versions, tags})` returns `{services, hostMap, warnings}`.
Supported version arrays come from installed Lando plugin builder metadata when
available; empty or unreadable metadata falls back to generated tables with a warning, and newest-version selection is numeric. Service types are a
closed set: the `BUNDLED` table (Lando service plugins) and the `COMPOSE` table
(upstream images), plus `network-storage`, which produces mounts and no service.
Anything else emits `service-unsupported`.

`lib/mapping/registry.js` resolves persistent/replica aliases and exact requested
versions against the frozen `IMAGES`, `TAGS` and `SOURCE` exports in generated
`lib/mapping/upsun-registry.js`. `mapCompose` uses a full pinned tag before empty
or `0` versions become `latest`; missing pins preserve the existing tag logic.
Tests can inject `tags` without changing the generated snapshot.

The dev-only `dev/update-upsun-registry.js` reads `upsun/meta`, records the
source ref/commit, and verifies Docker Hub tags for Linux amd64 and arm64. It strips
package epochs/revisions, rejects mismatched version prefixes and can fall back
to the highest formatter-compatible patch tag. Retired/decommissioned entries
remain in `IMAGES` but receive no pins. InfluxDB 3 is excluded because its upstream
image needs a different entrypoint; runtime mapping also skips InfluxDB 3+ with a warning. The registry is never fetched at runtime.

The builder adds `upsun-version-deprecated` or `upsun-version-retired` warnings for
requested application runtimes and services, including upstream EOL dates when
available. Composable applications and replicas are skipped;
supported, incoming and unknown versions/types do not warn. These warnings are
independent of local Lando plugin version substitution.

`mariadb-replica`, `postgresql-replica` (Flex) and `postgres-replica` (Fixed)
produce no Lando service. `raw.relationships.primary` (string or object form)
resolves to a `mariadb`/`mysql` primary for MariaDB or a `postgresql` primary for
PostgreSQL. Missing, unknown or incompatible primaries emit
`replica-primary-invalid` and produce no host map or initialization. Different
versions emit `replica-version-mismatch` but still map locally.
Replica host-map entries use the primary hostname and engine port/scheme, while
replica-owned endpoints keep their ordering and database paths. Each local user
is `<replica>_<endpoint>` with password `upsun`, unlike Upsun's usernames. With
no endpoints, the endpoint name is `mysql` or `postgresql`. Reads see primary
writes immediately, without replication lag.
MariaDB replica initialization creates users with the `ro` grant set, never
databases. Schema keys come from endpoint privileges (excluding `replication`),
then replica schemas/databases, primary schemas/databases, or `main` when no
privileges are listed. PostgreSQL replica roles use
`default_transaction_read_only = on` and inherit every non-replication primary
endpoint role, or `upsun` when the primary has no endpoints. Role membership
also exposes tables created later by migrations or pulls.
Replication endpoints (`replication: true` for PostgreSQL, `replication`
privileges for MariaDB) may have no default database without a path warning;
initialization creates their users without unsupported replication grants.

`DATABASE_TYPES` in `lib/mapping/database.js` is the single source of truth for
"is this a SQL service" and its dialect. `lib/mapping/services.js`,
`lib/pull.js`, `lib/tooling.js` and the relationship endpoint table derive from
it. A service type that maps to a container must also have an entry in
`ENDPOINTS` (`lib/config/relationships.js`), or its relationships resolve to a
null endpoint and export the string `"null"` as `<REL>_REL`;
`test/mapping-services.spec.js` asserts both properties against the list of
types Upsun documents.

SQL mapping also feeds `lib/mapping/database.js`. On every start, the closest
app runs idempotent statements for schemas, endpoint users and privileges. Both
MySQL-family and PostgreSQL users use password `upsun`.
`getDatabaseHost(service, model)` resolves the initialization host;
`getDatabaseInit(service, model)` builds its SQL. The builder appends replica
initialization after all primary initialization, regardless of declaration order.
PostgreSQL creates all endpoint roles before granting privileges. Default
privileges for readers and writers are set both for the initialization
connection's `postgres` role and `FOR ROLE` every admin/writer endpoint on the
same database, so objects created by any of them inherit the grants. The SQL
schema remains `public`.
Only the synthetic default PostgreSQL endpoint (`synthetic: true`) is created as a superuser; an explicitly named `upsun` endpoint is not.
MySQL/MariaDB grants are `admin: ALL PRIVILEGES`, `rw: SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, SHOW VIEW, EVENT, INDEX, TRIGGER`, and `ro: SELECT, SHOW VIEW, CREATE TEMPORARY TABLES`.
PostgreSQL `admin` owns the database and gets all database privileges; `rw` gets CONNECT, schema USAGE, table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT/UPDATE; `ro` gets CONNECT, schema USAGE and table/sequence SELECT.
Initialization revokes existing MySQL grants and PostgreSQL reader/writer object and default grants before granting the configured sets again on restart.
Pull, push and switch exclude replica relationships, including SQL endpoint-only
matches. Relationship shells run on the primary with replica credentials;
db-import/db-export target only generated SQL services, never replicas.

`getMailpitDefinition()` creates service `mailpit`, listens for SMTP on port 25,
and proxies the UI at `mail.<name>.<domain>`. PHP receives a generated
`sendmail_path` targeting `mailpit:25`. `config.mail: false` disables all of it.

## Start commands

`lib/hooks.js` returns `{name, cmd, user}` entries. App commands are ordered:

| Order | Name | User | Condition |
|---|---|---|---|
| 1 | `mounts` | app | mounts exist |
| 2 | `db-init:<service>` | app | local SQL service; closest app only |
| 3 | `provisioned` | app | always; touches `UPSUN_PROVISIONED_FILE` |
| 4 | `pre_start` | app | PHP app with `web.commands.pre_start` |
| 5 | `post_start` | app | `web.commands.post_start` exists |
| 6 | `deploy` | app | `hooks.deploy` exists |
| 7 | `post_deploy` | app | `hooks.post_deploy` exists |

Workers and cron sidecars receive mount creation only. Non-PHP `pre_start` is
handled by `/helpers/upsun-start.sh` before it executes the app command. The
builder sets `UPSUN_PROVISION_WAIT=300` only on the closest non-PHP app service with a
`db-init` step, so the start wrapper blocks on the `provisioned` marker.

`app.js` converts the arrays into `engine.run()` commands at `post-start`
priority 101. App-user entries resolve to the service `meUser`; root entries stay
root. A failure becomes a Lando warning with `lando restart` as the retry
command, and the error is passed through so `lando start` exits nonzero.

## Routes contract

`getProxyConfig(model, {domain, name}, targets)` returns `{proxy, warnings}`.
Each entry has `hostname`, string `port`, `pathname` and middleware records.
Targets include mapped HTTP data services (such as Varnish and Mercure) as well
as applications; their relationship host-map entries are preserved.
Standard middlewares set `X-Client-IP`, `X-Original-Route` and `X-Client-SSL`.
Invalid route URLs or redirect definitions throw clear errors; the primary route is explicitly marked or the first defined upstream route.

Redirect routes attach Traefik `redirectregex` middleware to their resolved
upstream target, or the primary target when the destination is external. They
are permanent 301 redirects. `redirects.paths` adds pathname entries or regexp
middleware to the upstream route; `code: 302` sets `permanent=false`.
Relative destinations use the expanded source route's host, including subdomains.
Wildcard redirect hosts such as `*.{default}` match subdomains rather than a literal asterisk.

For a Landofile named `my-project`, `www.{default}` resolves to
`www.my-project.lndo.site` and redirects to the canonical
`my-project.lndo.site` route. Proxy generation returns no redirect warning.

## CLI and sync

`lib/cli.js` exports the frozen `API_CONFIG` with endpoints
`https://api.upsun.com`, `https://auth.upsun.com` and `https://console.upsun.com`. Flex uses `upsun` /
`UPSUN_CLI_TOKEN`; Fixed uses `platform` / `PLATFORMSH_CLI_TOKEN`.

`lib/api.js` owns all direct API calls, using Node's built-in `fetch`:

- `getAccountInfo` exchanges an API token at `POST /oauth2/token` on the auth
  endpoint, then calls `getMe` (`GET /me` on the API endpoint).
- `getEnvironments` exchanges an API token and calls
  `GET /projects/<encoded-id>/environments` on the API endpoint.
- `registerOAuthClient` registers a fresh public client at `POST /oauth2/register`.
- `exchangeAuthorizationCode` exchanges a PKCE code at `POST /oauth2/token`.
- `createApiToken` posts a token name to `/users/<encoded-id>/api-tokens`.
- `revokeOAuthToken` revokes the temporary refresh token at `POST /oauth2/revoke`.

The shared `request` helper retries thrown fetch errors, HTTP 429 and HTTP 5xx
twice (three attempts total), waiting 500 ms then 1000 ms. The exported
`RETRY_DELAY_MS` supplies the base delay at call time so tests can set it to zero.
These defaults apply to both calls in `getAccountInfo`, `getMe`,
`registerOAuthClient` and `revokeOAuthToken`.
Other 4xx responses are never retried, including 401 step-up challenges.
Final HTTP errors retain their message, `status` and `body`; final network
errors propagate unchanged.

`createApiToken` and `exchangeAuthorizationCode` explicitly disable retries.
Token creation is non-idempotent: a lost response could create a duplicate token
whose one-time secret is lost. Authorization codes are single-use.
Each attempt has a 30-second AbortController deadline covering both fetch and
the JSON response read, configurable through `UPSUN_API_TIMEOUT_MS`. Timeouts
follow the same retry policy; neither single-use operation is retried.

`lib/login.js` runs browser login for remote init and the pull/push/switch
account picker. It binds an HTTP callback on `127.0.0.1` at an ephemeral port.
The redirect URI must be exactly `http://127.0.0.1:<port>`: no trailing slash,
path or `localhost`. Authorization uses S256 PKCE (32 random bytes for the
verifier) and a random state (16 bytes). Wrong-state and non-root requests
do not settle the login. Abort, timeout and callback completion close the server.

Upsun only creates API tokens within 5 minutes of a login, so the authorize
request carries `max_age=300`. If token creation still returns a 401
`insufficient_user_authentication` step-up challenge (RFC 9470), Lando repeats
the browser login once with the challenge's `max_age` and `amr` (space-separated,
like the Upsun CLI).

After authorization, Lando reads `/me`, creates `Lando (<hostname>)` and
immediately caches the API token, before cloning or syncing can fail. Every
refresh token is revoked best-effort after exchange, including when
token creation fails. OAuth clients are not cached; they expire server-side.
Only the named API token is retained locally, and no credential secrets are printed.

Enter skips login and failures fall back to pasting an API token. Escape must
not skip: it leaves typed text in readline's buffer for the next password prompt.
Known usernames get the Console URL `/-/users/<encoded-username>/settings/tokens`;
otherwise the fallback is `/-/users/me/settings`, where the user selects API Tokens.
There is no username-free tokens deep link. Hidden login questions use the same
answer name as `--upsun-auth` / `--auth`, so explicit flags bypass them.

`auth upsun` is app-level tooling with `cmd: []`, so it prompts and initializes
the app but creates no container runners. Its `upsun` positional accepts only
`upsun`. It is generated for Flex and Fixed, never `layout: magento`.
`app.js` handles `post-auth`: validate the token, persist the vendor token cache,
merge `{token, email, date}` into `<app>.meta.cache`, and print the connected email.
HTTP 400/401/403 removes the rejected token and matching app token/email; outages
leave both caches intact. Pull/push/switch also persist the selected account
after successful completion; rejected tokens are removed and account-refresh outages warn without failing the completed sync.
`upsun.rejected-tokens` persists rejected token strings so `readTokens` cannot
re-import them from either vendor's CLI file. Successfully writing a token back
to its vendor cache removes it from this rejection set.
The builder prefers the app meta token for CLI tooling only while
it is present in the vendor's cached tokens; otherwise it uses `cachedTokens[0]`.

Pull and push expose authentication, environment, project, relationship, mount,
`--skip-db`/`--no-db`, `--skip-files`/`--no-files` and `-A/--app` options. Pull
also exposes `--all-mounts`; push adds `--force`. `getPullTask` receives the
app's saved `account`; when its token is still in the vendor cache, `--auth`
becomes a non-interactive option defaulting to that token (described by the
email) instead of the picker. `--no-db`/`--no-files` are yargs aliases that
boolean negation parses as `{db: false}`, so the hidden `skip-*` prompts copy
them from `process.argv` into the answers; `--no-skip-db` never counts as a skip.

`lib/switch.js` builds `switch [environment]`. The positional is optional and
defaults to undefined so the early yargs parse never demands it; `--environment`
(`--env`, `-e`) is the same value. When neither is given, an interactive list
fetches the project's environments through `api.getEnvironments` using the
answered token and project. It drops `--all-mounts` and the pull `env` option.

Database sync is per-relationship: `upsun_sync_database` resolves `NAME` or
`NAME:DATABASE` to the `<REL>_*` variables, with the explicit database
overriding `<REL>_PATH` and passed to `db:dump`/`db:sql --schema`. Every
selection is validated before the first change. Pull decompresses the dump to
a `mktemp` directory (removed on exit) and refuses an empty dump. MySQL first backs
up the local database using `UPSUN_MYSQL_DUMP` (or `mysqldump` / `mariadb-dump`)
with endpoint credentials, `--single-transaction --no-tablespaces` and default
trigger coverage, without routines/events. A missing client or failed backup
aborts before cleanup. Before any drop, a recovery copy is preserved outside the
exit-cleaned directory; signals and other failures report its path, and only
successful import removes it. It drops existing tables and views with foreign-key checks
off and loads the dump. Any cleanup/import failure regenerates the drop list,
clears partial objects and loads the backup. Recovery still exits nonzero; if it
fails, the backup is copied outside the exit-cleaned directory and its path printed
(the original directory is retained if that copy cannot be made);
for PostgreSQL it drops tables, views, materialized views, sequences, public routines, standalone enum/domain/composite types and large objects
(skipping extension-owned objects, no `CASCADE`) and loads the dump in one
`--single-transaction` with `ON_ERROR_STOP=1`. Before import the PostgreSQL
dump is filtered through injectable `UPSUN_AWK`: `ACL` and `DEFAULT ACL`
sections are removed because they name remote roles, and `BEGIN;`/`COMMIT;`
wrappers inside `BLOBS` sections are removed so they cannot commit the outer
transaction early; the rewrite preserves COPY payloads and dollar-quoted bodies and removes complete multiline extension comments. The connection uses
`UPSUN_PG_SUPERUSER` (default `postgres`) with an empty password. `clean.sql`
starts with identifier-quoted `SET ROLE` for the endpoint user, so cleanup and
ordinary imported objects retain endpoint ownership. The filter emits `RESET ROLE`
for `DROP EXTENSION` statements and EXTENSION / COMMENT-on-EXTENSION
sections, then restores the endpoint role. The quoted role reaches awk through
`ENVIRON` to preserve backslashes. Extension SQL thus runs as superuser, while
other SQL errors still roll back the whole transaction. Pull
does not reapply endpoint grants; database init does that on every start.
Empty selections print a notice and sync nothing for that category; `none` is
explicit.

`db-import <file>` / `db-export [file]` are generated from
`lib/tooling.js#getDatabaseTooling` on Lando's `/helpers/sql-import.sh` and
`sql-export.sh`, run with `service: ':host'` and default to the closest app's
first SQL relationship service. For
`layout: magento`, `pull`, `push` and `switch` are replaced with commands that
exit 1 and point at `magento-cloud`.

### Tooling router

The builder generates the full command set for every application, not only the
closest one, and keeps the closest app's generated set plus recipe options in
`options.tooling`. It never merges `app.config.tooling` into that set: core writes
`<app>.recipe.cache` before applying Landofile tooling, so removed user commands
cannot linger in the recipe cache.

`lib/tooling-router.js` builds `app.upsun.toolingRouter` entries keyed by absolute
`source.root`. The project root and closest app's source path carry `tooling: {}`,
leaving core's recipe-cache + fresh Landofile merge untouched. Paths are deduplicated
with those empty routes taking precedence, including when another app shares them.
Other apps carry their generated commands minus names owned by Landofile tooling
or recipe options. `routeTooling` adds `false` only for closest-app generated commands
that the routed app lacks and the user does not own. Commands generated only for
other non-closest apps need no markers because they are not in the recipe base.

`app.js` applies the router twice. At `post-init` 4 (before core builds
`app.tasks` at 5) it replaces route-owned commands with those from the closest
ancestor of `process.cwd()`. Whole-command replacement prevents another app's
relationship or mount choices from surviving an array merge on the live path.
It removes non-object entries even for empty routes before
core creates tasks, so a cold run already targets the cwd app. At `post-init` 9
it persists `JSON.stringify(routes)` to the
`<app>.tooling.router` cache for core's warm path, which reads that cache with
a double `JSON.parse` before the app is initialized. Interactive functions do
not survive the cache; app-level commands reload them during init.
Core deep-merges the selected cached route over recipe and Landofile tooling on
the warm path. After adding or changing a Landofile command that collides with
generated tooling, refresh with `lando --clear`, `lando start` or `lando rebuild`
before using it in another app's directory. Root and closest-app routes stay empty
and need no refresh for those Landofile changes.
`post-uninstall` removes the key, and `clearToolingCaches` drops both
`<app>.recipe.cache` and `<app>.tooling.router` whenever a token is saved or
rejected (`post-auth`, `post-pull`, `post-push`, `post-switch`, the
`cli-*-answers` hooks) so the warm path cannot keep a stale token or option set.

## Helper scripts

| Script | Arguments | Main configuration |
|---|---|---|
| `upsun-env.sh` | sourced | `PLATFORM_APP_DIR` |
| `upsun-exec.sh` | command and arguments | sources `upsun-env.sh`, then `exec` |
| `upsun-start.sh` | none | `UPSUN_ENV_HELPER`, `UPSUN_PROVISION_WAIT` (0), `UPSUN_PROVISIONED_FILE` (`/dev/shm/upsun-provisioned`), `PLATFORM_APP_DIR`, `PLATFORM_PRE_APP_COMMAND`, `PLATFORM_APP_COMMAND` |
| `upsun-hook.sh` | `build`, `deploy`, `post_deploy`, `pre_start`, `post_start` | `PLATFORM_APPLICATION`, `PLATFORM_APP_DIR` |
| `upsun-operation.sh` | operation name | `PLATFORM_APPLICATION`, `PLATFORM_APP_DIR` |
| `upsun-cron.sh` | cron name | `PLATFORM_APPLICATION`, `PLATFORM_APP_DIR` |
| `upsun-crond.sh` | none | `PLATFORM_APPLICATION`, `UPSUN_CRONTAB` (`/tmp/crontab`), `UPSUN_SUPERCRONIC`, `UPSUN_CRON_SCRIPT` |
| `upsun-php-extensions.sh` | `--enable a,b --disable c` | `UPSUN_PHP_BIN`, `UPSUN_PHP_EXT_INSTALLER`, `UPSUN_PHP_EXT_ENABLE`, `UPSUN_PHP_EXT_DIR`, `UPSUN_PHP_CONF_DIR` |
| `upsun-xdebug.sh` | `on [mode]`, `off` | `UPSUN_PHP_CONF_DIR`, `UPSUN_PHP_BIN`, `UPSUN_PHP_EXT_ENABLE`, `UPSUN_PGREP`, `UPSUN_KILL`, `UPSUN_RM`; writes `zzz-upsun-xdebug.ini` (unloads legacy Xdebug 2 on `off`) and reloads php-fpm |
| `upsun-db-init.sh` | host, `mysql`/`pgsql`, base64 SQL | `UPSUN_DB_WAIT` (60), `UPSUN_MYSQL_CLIENT`, `UPSUN_PSQL_CLIENT`; exits 4 on timeout |
| `upsun-install-supercronic.sh` | none | `SUPERCRONIC_VERSION` (0.2.49), `UPSUN_SUPERCRONIC_SHA1` (pinned per-arch SHA-1 override), `UPSUN_CURL`, `UPSUN_INSTALL_DIR`; exits 6 on checksum mismatch |
| `upsun-install-node.sh` | major version | `UPSUN_CURL`, `UPSUN_NODE_PREFIX`, `UPSUN_NODE_BIN`, `UPSUN_NODE_DIST`; verifies against `SHASUMS256.txt`, exits 6 on mismatch |
| `upsun-install-cli.sh` | `upsun`/`platform`, optional version | `UPSUN_CURL`, `UPSUN_CLI_INSTALL_DIR`; downloads from `upsun/cli` releases, verifies against `checksums.txt`, exits 6 on mismatch |
| `upsun-pull.sh`, `upsun-push.sh` | sync flags, plus `--all-mounts`, `--skip-db`/`--no-db`, `--skip-files`/`--no-files`, `-A/--app` where supported; `-r NAME[:DATABASE]` | `PLATFORM_APPLICATION_NAME` defaults `-A`; `UPSUN_SYNC_ENV`, `UPSUN_MYSQL_CLIENT`, `UPSUN_MYSQL_DUMP`, `UPSUN_PSQL_CLIENT`, `UPSUN_PG_DUMP`, `UPSUN_GUNZIP`, `UPSUN_MKTEMP`, `UPSUN_RM`, `UPSUN_CAT`, `UPSUN_SYNC_TMPDIR` |
| `upsun-switch.sh` | `[environment]`, `--environment`/`--env`/`-e`, forwarded pull flags | stashes `.lando.yml` in a `mktemp` dir, checks out the branch, then runs the pull script |
| `upsun-sync-env.sh` | sourced | shared sync argument parsing, project binding, environment activation, `upsun_sync_database`, `upsun_sync_selections`, `upsun_sync_temp` |

`upsun-hook.sh build` removes `/app/vendor/bin`, `/app/bin` and their
`PLATFORM_APP_DIR` equivalents from PATH before sourcing `.environment`, so
build hooks use the image's tools unless `.environment` explicitly re-adds them.
Hook, operation, cron and pre_start bodies run with `bash -eo pipefail -c`, so a
failed non-final pipeline stage fails the body.

PostgreSQL push dumps use `--clean --if-exists --no-owner --no-acl` and are fed to
`db:sql` on stdin with `ON_ERROR_STOP` and an outer transaction. A minimal awk
filter strips BLOBS transaction wrappers and complete extension drops/comments while preserving COPY payloads and dollar-quoted bodies.
Unforced pushes accept only verified development/staging environments: production
or main/master exits 6, and failed or unrecognized type lookups exit 7. A missing
or unreadable parent lookup exits 2 instead of guessing an environment.
Pull falls back only after a failed paused/inactive wake unless `--env`/`--no-parent` disables it; push never falls back, and failed status commands hard-stop.
Initial or post-wake `dirty` readiness polls only status every 30 seconds, with at most 600 seconds of sleep (`UPSUN_SLEEP`, default `sleep`). Only `active` succeeds; timeout, deleting/unknown/empty statuses, failed queries, or paused/inactive during polling return 2 without wake or parent fallback. Foreground progress uses a spinner/countdown on terminal stderr and one line per retry when piped (including Lando tooling); Ctrl-C exits 130.
Push pre-selects no database relationships and preserves a remote MySQL/MariaDB safety dump before import, printing its restore command on failure.

Every installer honours `UPSUN_CURL` so tests can substitute a fake downloader.
All CLI, Node.js and Supercronic downloads pass `--retry 3` to curl for transient
5xx, 408, 429 and timeout failures, including release lookups and checksum files.
Nothing is installed when a checksum fails.

Generated files include `/dev/shm/upsun-provisioned`, `/tmp/crontab`, and PHP ini
fragments for app config, Xdebug and Mailpit.

## Warnings

`lib/warnings.js` maps codes to titles. Codes emitted by the model, mapping and
builder: `composable-runtime-picked`, `php-extension-unsupported`,
`relationship-unknown-service`, `relationship-unresolved` (target has no local
service or application; skipped), `relationship-path-null` (endpoint without a
default schema/database; null path, no `<REL>_PATH`), `runtime-unsupported`,
`service-unsupported`, `version-fallback`, `version-unsupported`,
`varnish-vcl-ignored`, `recipe-deprecated-alias`, `solr-cores-collapsed`,
`service-config-ignored`, `dependency-runtime-missing`, `plugin-unreadable`,
`web-upstream-unsupported`, `replica-primary-invalid`, `replica-version-mismatch`,
`plugin-missing`, `plugin-outdated`, `upsun-version-deprecated` and `upsun-version-retired`.

## Testing

- Model/env/routes: `config-load.spec.js`, `config-relationships.spec.js`,
  `env.spec.js`, `routes.spec.js`.
- Mapping: `mapping-applications.spec.js`, `mapping-php.spec.js`,
  `mapping-services.spec.js`, `mapping-database.spec.js`,
  `mapping-versions.spec.js`, `nginx.spec.js`.
- Lifecycle scripts: `hooks.spec.js`, `start.spec.js`, `hook.spec.js`,
  `operation.spec.js`, `crond.spec.js`, `db-init.spec.js`, `installers.spec.js`,
  `php-scripts.spec.js`.
- Sync: `pull.spec.js`, `push.spec.js`, `sync.spec.js`, `sync-native.spec.js`,
  with `mock-platform.sh`, `mock-db-client.sh` and `sync-harness.sh` fixtures.
- Glue: `builder.spec.js`, `app.spec.js`, `init.spec.js`, `project.spec.js`.
- Integration examples are Leia READMEs. Host-side script tests require Bash and
  `jq`.
