# AGENTS.md

## Overview

`@lando/upsun` is a Lando v3 recipe plugin (`recipe: upsun`) that runs Upsun Flex, Upsun Fixed and Adobe Commerce Cloud projects locally. It reads the project's Upsun config, translates it into Lando services, sets the `PLATFORM_*` environment, runs hooks/mounts/crons on start, and wires `lando pull` / `push` / `switch` through the Upsun CLI.

- Node >= 20, CommonJS (`'use strict'` + `require`).
- Tests: mocha + chai (`chai.should()`), coverage via nyc.
- Lint: ESLint 9 flat config (`eslint.config.js`) with `eslint-config-google` and `eslint-plugin-jsdoc`.
- JSDoc uses **`@returns`**, not `@return`. Pantheon and core use `@return`; do not "fix" this repo to match them (`jsdoc/check-tag-names` defines `returns`).

## Maintenance
- Keep this file up to date. If you identify a serious repo-specific gotcha that is likely to trip future agents, update this file in the same change.

## Commands
- `npm run lint`: ESLint.
- `npm run test:unit`: all unit tests with nyc coverage.
- `npm test`: lint + typecheck + unit tests. Run before finishing any change.
- `npm run test:leia`: Leia integration tests over `examples/**/README.md`. **CI-only, do not run locally**: it starts real containers and modifies the host.
- `npm run typecheck`: checks `jsconfig.json` through `dev/typecheck.js`, excludes dependency-file diagnostics and fails on repository/configuration errors. Gated in `npm test` and CI. `npm run typecheck:full` includes node_modules and preserves the compiler exit status.
- `npm run docs:dev` / `docs:build` / `docs:preview`: VitePress docs in `docs/`.
- Single spec: `npx mocha --timeout 5000 test/<file>.spec.js`.
- `node dev/update-versions.js`: regenerates `lib/mapping/version-tables.js` (data only) from installed plugins in `~/.lando/plugins/@lando` (override with `LANDO_PLUGINS_DIR`; output path with `UPSUN_VERSIONS_OUTPUT`). Commit the result.
- `node dev/update-upsun-registry.js`: regenerates Upsun lifecycle metadata and verified multi-arch compose pins; `UPSUN_META_REF` defaults to `master`, `UPSUN_META_DIR` reads a local checkout, `UPSUN_REGISTRY_OUTPUT` changes the output.

## Architecture

Pipeline (pure modules first, glue last). `docs/architecture.md` and `docs/lifecycle.md` are the authoritative contracts; update them when behavior changes.

1. `lib/config/`: `detect(root)` picks the flavor/layout, then `flex.load` or `fixed.load` reads YAML, raw `config.overrides` / `config.variables` from the Landofile are lodash-merged into matching raw apps/services (arrays merge by index), then `normalize` produces the pure Model (`{flavor, layout, root, configFiles, applications, services, routes, ...}`). `index.js` exports `detect` and `load`. `relationships.js` resolves app/service relationships; `yaml.js` handles the custom YAML types.
2. `lib/mapping/`: Model to Lando v3 service definitions. `runtimes.js` (application containers, `RUNTIME_TYPES`), `services.js` (data services: Lando plugins plus a `COMPOSE` table for raw images, Mailpit; replicas map only to primary-backed host entries), `versions.js` (generated version tables, `resolveVersion`, `getSupportedVersions`, `getVersionTableStatus`), `registry.js` (generated Upsun upstream pins, type aliases and lifecycle warnings), `database.js` (schema/user/grant init and replica primary resolution), `php.js` (extensions, ini).
3. `lib/env.js`: builds the `PLATFORM_*` runtime environment (base64 JSON payloads, canonicalized ordering). `lib/routes.js` + `lib/domains.js`: routes to Lando proxy config and local hosts. `lib/nginx.js`: web location config.
4. `lib/hooks.js`: start command list (mounts, db init, `pre_start`, `post_start`, `deploy`, `post_deploy`). `lib/project.js`: reads the project id from `.upsun/local/project.yaml` or `.platform/local/project.yaml`. `lib/workspace.js`: repo/branch and workspace helpers.
5. `builders/upsun.js`: the recipe builder. Orchestrates everything above, puts closest-app generated tooling plus recipe options (never `app.config.tooling`) in `options.tooling`, and builds `toolingRouter` via `lib/tooling-router.js`: empty root/closest-app routes, masked deltas for other apps, deduplicated paths with closest-app precedence. Merges top-level `services:` over the generated services and stashes results on `app.upsun` (`model, flavor, cli, closestApp, closestType, hostMap, branch, projectId, mail, startCommands, toolingRouter, warnings`). `app.js` and `index.js` read from that object.
6. `app.js`: per-app lifecycle events (only when `utils.isUpsunRecipe`):
   - sets `app.id` from `config.id`; warns on deprecated `recipe: platformsh`
   - `post-init`: forwards `app.upsun.warnings` via `lib/warnings.js`
   - `post-init` @4: shallow-merges the cwd's router entry into `app.config.tooling` and removes non-object commands even for empty routes before core builds `app.tasks` at @5; `post-init` @9 persists the router to the `<app>.tooling.router` cache; `post-uninstall` removes it
   - `pre-start` @3: adds a `upsun-proxy-priorities` compose service with Traefik router priorities (see Gotchas)
   - `post-start` @101: runs `app.upsun.startCommands` through `app.engine.run` (`buildRunCommands`); failure adds a warning message
   - `ready` @0: sets `app._defaultService` to the closest app before core bakes the ssh default at `ready` @1
   - `post-pull` / `post-push` / `post-switch`: non-fatal account refresh via `getAccountInfo`; caches valid tokens and clears tooling caches, scrubs rejected tokens, warns on outages
   - `post-auth`: validates and caches the chosen account for the app's vendor, prints its email, and removes rejected tokens without running containers
7. `index.js`: global Lando events. `cli-{pull,push,switch}-answers` drops a cached token Upsun rejects; `cli-ssh-run` reads `info`/`primary` from the compose cache when `_app.info` is absent, retargets `appserver` to the primary service and wraps only identified app containers in `/helpers/upsun-exec.sh`.

Tooling and sync: `lib/tooling.js` (language tooling, relationship shells, `getMagentoTooling`), `lib/pull.js`, `lib/push.js`, `lib/switch.js` build tooling tasks that call the bash scripts; they take the app's saved `account` and make `--auth` non-interactive when its token is still cached. `lib/tooling-router.js` (`selectRoute`, `withRootFallback`, `routeTooling`, `forCache`, `clearToolingCaches`) handles per-cwd routing.

Auth: `lib/api.js` (native `fetch`, no HTTP library), `lib/login.js` (loopback PKCE browser login, named API token creation and immediate caching), `lib/tokens.js` (lando cache `upsun.tokens`, legacy `platformsh.tokens`, plus the CLI's own saved token file), `lib/auth.js` (init/pull prompts), `lib/cli.js` (`resolveCli`: flex uses the `upsun` binary and `UPSUN_CLI_TOKEN`; fixed uses `platform` and `PLATFORMSH_CLI_TOKEN`; `getCliEnv`, `getInstallStep`).

## Directory map

| Path | Purpose |
| --- | --- |
| `index.js` | Plugin entry; global `lando.events` hooks |
| `app.js` | App lifecycle hooks; `buildRunCommands` |
| `plugin.yml` | `legacy: true` autoscan plugin manifest; docs sidebar hints |
| `builders/upsun.js`, `builders/platformsh.js` | Recipe builder; deprecated `platformsh` alias re-exports the same builder |
| `inits/upsun.js` | `lando init --source upsun` |
| `lib/config/` | detect, flex/fixed loaders, normalize, relationships, YAML types |
| `lib/mapping/` | Model to Lando services, versions, database init, PHP |
| `lib/*.js` | env, routes, domains, nginx, hooks, tooling, pull/push/switch, api, tokens, auth, cli, project, workspace, utils, warnings |
| `scripts/upsun-*.sh` | Namespaced container-side bash helpers, mounted at `/helpers/` |
| `dev/` | Host-only maintainer scripts: typecheck and version/registry generators (npmignored) |
| `test/*.spec.js` | Unit tests; `test/fixtures/` holds config fixtures, mock binaries, harnesses |
| `examples/` | Leia integration specs (`README.md` files are executable) |
| `docs/` | VitePress site; `docs/architecture.md`, `docs/lifecycle.md`, `docs/development.md` |
| `.github/workflows/` | `pr-linter` (lint), `pr-unit-tests` (test:unit), `pr-docs-tests` (lint + docs:mvb + docs:build), `pr-integration-tests` (Leia via `lando/run-leia-action`), `pr-node-version-check`, `release` (lint + test:unit + npm publish), `label-add-to-project` |

## Bash scripts

`scripts/upsun-*.sh` run inside containers as `/helpers/upsun-*.sh`. Conventions:

- `#!/bin/bash`; first thing sourced is `. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"`.
- Shared functions live in `upsun-sync-env.sh` and use the `upsun_` prefix (`upsun_platform`, `upsun_parse_sync_args`, `upsun_ensure_active_environment`, ...).
- Every external binary or path is injectable through an `UPSUN_*` env var with a production default (`UPSUN_CLI_BINARY`, `UPSUN_CURL`, `UPSUN_MYSQL_CLIENT`, `UPSUN_PSQL_CLIENT`, `UPSUN_SUPERCRONIC`, `UPSUN_PHP_BIN`, `UPSUN_KILL`, `UPSUN_PGREP`, `UPSUN_ENV_HELPER`, `UPSUN_SYNC_ENV`, ...). Tests rely on this; keep new binaries injectable.
- Shared env helper: `upsun-env.sh` (source it, or `upsun-exec.sh` to wrap a command).
- Downloads use `curl --retry 3` for transient failures.

| Script | Does |
| --- | --- |
| `upsun-env.sh` | Source to get an Upsun SSH-like shell env (`.environment` sourced) |
| `upsun-exec.sh` | Run a command with that env; prefix for tooling and `lando ssh` |
| `upsun-start.sh` | Start-time sequencing (mounts, provisioning wait, hooks) |
| `upsun-hook.sh` | Run one hook (`build`/`deploy`/`post_deploy`) extracted from `PLATFORM_APPLICATION` |
| `upsun-operation.sh` | Run a runtime operation with the app env |
| `upsun-db-init.sh` | Create schemas, users and grants for MariaDB/MySQL/PostgreSQL |
| `upsun-cron.sh` / `upsun-crond.sh` | Run one cron job once / run the cron table with supercronic |
| `upsun-install-cli.sh` | Install the `upsun` or `platform` CLI from GitHub releases |
| `upsun-install-node.sh`, `upsun-install-supercronic.sh`, `upsun-php-extensions.sh` | Build-step installers |
| `upsun-xdebug.sh` | Toggle Xdebug |
| `upsun-sync-env.sh` | Shared pull/push helpers: CLI selection, arg parsing, wake environment, parent fallback |
| `upsun-pull.sh`, `upsun-push.sh`, `upsun-switch.sh` | The sync tooling commands |

## Style

Enforced by `eslint.config.js` (google + jsdoc recommended):

- 2 spaces, single quotes, semicolons, `max-len` 120 (comments ignored), `arrow-parens: as-needed`. `indent` and `comma-dangle` rules are off.
- Every file starts with `'use strict';`.
- JSDoc is required on `FunctionDeclaration` only (not arrows, methods or classes). Use `@param {type} name` and `@returns {type}`; `jsdoc/check-types`, `check-param-names` and `valid-types` are errors, descriptions are optional.
- Types go in JSDoc; shared typedefs live in co-located `lib/**/*.types.js` files and are checked by `npm run typecheck`.
- Lodash is used in glue code (`builders/upsun.js`, `app.js`, `inits/upsun.js`, `lib/utils.js`, `lib/auth.js`, `lib/push.js`, `lib/switch.js`, `lib/workspace.js`, `lib/config/flex.js`). `lib/mapping/*`, `lib/env.js`, `lib/routes.js`, `lib/domains.js`, `lib/cli.js`, `lib/tokens.js`, `lib/api.js` are lodash-free by design; keep them that way.
- `_` is a declared global in the lint config; still `require('lodash')` explicitly where used.

## Adding or changing a service mapping

1. Lando-plugin-backed services: edit `lib/mapping/services.js`; refresh version tables with `node dev/update-versions.js`.
2. Raw-image services: add an entry to the `COMPOSE` table in the same file.
3. Add a case to `test/mapping-services.spec.js`. If user-visible, add an example under `examples/` with a Leia `README.md` and a CHANGELOG bullet.
4. Update the mapping contract in `docs/architecture.md`.

## Testing conventions

- Pure unit tests over `lib/` against fixtures; `builders/upsun.js`, `app.js`, `index.js` are glue and tested with fake `app`/`lando` objects.
- Builder tests (`test/builder.spec.js`) call `recipe.builder(MockRecipe, recipe.config)` with a tiny `MockRecipe` parent that captures `options`.
- Bash scripts are tested by running them: `execFileSync('bash', [script, ...])` with `UPSUN_*` env overrides and mock binaries from `test/fixtures/mock-*.sh` (often prepended to `PATH`). `test/fixtures/sync-harness.sh` sources `upsun-sync-env.sh` and exposes its functions; `test/fixtures/log.sh` stands in for `/helpers/log.sh`.
- Bash-backed suites use `test/helpers/describe-linux.js` to skip non-Linux hosts; pure JavaScript tooling checks still run everywhere.
- Config fixtures: `test/fixtures/flex-*`, `fixed-*`, `mixed-*`, `no-apps`, `no-config`, `installers`, `plugins`.
- HTTP is stubbed by assigning `global.fetch` directly (no sinon/nock); restore it in `afterEach`.
- Temp dirs via `fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-...'))`.
- New spec files must match `test/**/*.spec.js`; nyc `include` covers `builders/`, `inits/`, `lib/`.

## Config and caches

- Detection (`lib/config/detect.js`): `.upsun/*.yaml` means Flex (`layout: upsun`); `.platform.app.yaml` + `.platform/` means Fixed (`layout: platform`, `platform` CLI); `.magento.app.yaml` + `.magento/` means Adobe Commerce Cloud (`flavor: fixed`, `layout: magento`). Mixing Flex and Fixed files, or Magento with either, is an error.
- Landofile: `recipe: upsun` (or deprecated `platformsh`); `config.id` sets the Upsun project id (`app.id`); when absent the builder falls back to `readLocalProjectId` and then `'lando'`. `config.xdebug` (default `false`), `config.mail` (default `true`, skipped if the project already defines a `mailpit` service) and `config.crons` (default `false`) feed the mapper.
- Token caches: lando cache keys `upsun.tokens` and legacy `platformsh.tokens`, plus `<app>.meta.cache` (`token`, `email`). CLI tooling prefers the app meta token while it is cached, otherwise the first cached token. The CLI's own saved token is also offered in the `--auth` picker.
- Generated tooling is cached by core in `<app>.recipe.cache` and `<app>.tooling.router`, both read on the warm path before app init. `clearToolingCaches` drops both whenever a token is saved or rejected. If a tooling or builder change seems ignored, run `lando --clear` before assuming the code path is wrong.

## Repo-Specific Gotchas

- **Replicas share their primary, not a container.** Resolve `raw.relationships.primary` with `getReplicaPrimary`; local users are `<replica>_<endpoint>`. Replica init creates only users/grants on the primary and must follow primary init regardless of model order. Sync choices exclude replica targets, but relationship shells run on the primary using replica credentials.

- **Raw PostgreSQL dumps break atomic pulls.** `pg_dump` plain output wraps large objects in `BEGIN;`/`COMMIT;`, which commits psql's `--single-transaction` early. The shared `upsun_rewrite_pg_dump` strips BLOBS wrappers, remote ACLs and complete multiline extension comments while preserving dollar-quoted bodies and COPY payloads. Pull connects as local `postgres` with an empty password and uses identifier-quoted `SET ROLE` for endpoint-owned cleanup and objects; extension drops/creation run after `RESET ROLE`. Cleanup also drops public non-extension routines, standalone enum/domain/composite types and large objects. Pass the quoted role through awk `ENVIRON`, not `-v`. Never pipe a raw dump into a single-transaction psql.

- **MySQL pull recovery needs a fresh drop list.** Back up tables, views and triggers before cleanup; routines/events are excluded because cleanup never drops them. A failed cleanup/import may have created new objects, so query again before restoring. Recovery must use guarded commands under `set -eo pipefail`. If restoration fails, preserve the backup outside `sync_temp` before its EXIT trap removes it (or retain the original directory if copying fails).

- **`env -I` is not an activeness test.** `upsun environment:list --no-inactive` drops only `inactive`; `paused`, `dirty` and `deleting` remain listed. `upsun_require_active` reads `environment:info -e <env> status`; initial/post-wake dirty polls only status every 30 seconds for at most 600 seconds of sleep (`UPSUN_SLEEP`). Only active succeeds; timeout, failed queries and any non-dirty/non-active retry status return 2 and hard-stop. Deleting/unknown/unreadable initial statuses also hard-stop. Only a failed direct paused/inactive wake returns 1 and permits pull's parent fallback unless `--env`/`--no-parent` disables it. Push never falls back. Lando pipes stdout/stderr, so progress is one line per retry there; terminal stderr gets a foreground spinner/countdown. Bash mocks default to `MOCK_STATUS-active`; successful wakes record `active` in a `.status` file; `MOCK_STATUS_SEQUENCE` overrides successive queries.

- **PostgreSQL superuser is synthetic-only.** `endpointEntries` marks only the unconfigured default endpoint `synthetic: true`; an explicitly configured `upsun` endpoint is not a superuser.
- **Xdebug mode is ini-driven.** `@lando/php` exports `XDEBUG_MODE`, which Xdebug reads over php.ini at MINIT (the FPM master), so the mapping blanks it in `overrides.environment` and writes `xdebug.mode` into the generated php.ini; `upsun-xdebug.sh` writes `zzz-upsun-xdebug.ini` and reloads php-fpm (a re-exec). Pool `env[XDEBUG_MODE]` is applied per worker after MINIT and does nothing. Lando's images ship `xdebug.so` disabled, and `install-php-extensions` refuses to reinstall it, so `upsun-php-extensions.sh` enables any `.so` already in the extension dir instead.
- **PHP nginx must target its own app.** Mapping passes `fpmHost: app.name` so `fastcgi_pass` uses the application's service name, never the shared `fpm` alias.
- **Workers must not inherit web commands.** The worker mapper always overrides `PLATFORM_APP_COMMAND` (empty when absent) and clears web pre/post-start variables. Static nginx uses both `upstream: null` and `fpmHost: null`; null upstream alone selects PHP rendering.
- **Bash specs must isolate child startup.** Strip `BASH_ENV`, `ENV`, `SHELLOPTS` and `BASHOPTS` from child envs and set a timeout on `execFileSync`/`spawnSync`. `test/pull.spec.js` uses local `childEnv` and `spawnSync` wrappers with a 10000 ms timeout; this is not a shared helper.
- **TypeScript config filenames need forward slashes.** Normalize the path passed to `ts.readConfigFile`; backslashes plus malformed JSON trigger an internal assertion instead of a diagnostic on Windows.

- **Build hook PATH**: `@lando/php` prepends `/app/vendor/bin:/app/bin` to PATH; `upsun-hook.sh build` strips them and their app-directory equivalents before sourcing `.environment` so build-time Composer is the image's, not the project's.
- **`tooling.router` is double-JSON.** Core reads the `<app>.tooling.router` cache with two `JSON.parse` calls, so `app.js` stores `JSON.stringify(routes)` through `cache.set` (which serializes again). The recipe cache excludes Landofile tooling. Root and closest-app routes carry `{}` so fresh Landofile commands win there; duplicate paths favor those empty routes. Other apps carry generated commands minus Landofile-owned names, with `false` only for missing closest-app generated names not owned by the Landofile. After adding/changing a colliding Landofile command, refresh with `lando --clear`, `lando start` or `lando rebuild` before using it in another app's directory. Functions (interactive prompts) do not survive; app-level commands reload them at init. The live `post-init` handler must shallow-merge whole command objects, not deep-merge them: array merging leaks another app's relationship/mount choices. Remove non-object entries even for empty routes before core builds live tasks.
- **Switch positional is optional.** `switch [environment]` declares `positionals.environment` with no default so core's early yargs parse does not demand it; `--env`/`-e`/`--environment` are aliases and `upsun-switch.sh` parses all three forms. Keep the `auth upsun` positional default (`upsun`): core parses argv twice and the first parse consumes it.
- **`--no-db`/`--no-files` are negations to yargs** (`{db: false}`), not aliases. `lib/pull.js#copyAlias` copies them from `process.argv` into the `skip-*` answers inside the hidden prompts; `--no-skip-db` must not count as a skip. The bash side accepts both spellings.
- **`config.overrides` is raw Upsun config, not Lando services.** It is merged before normalization in `lib/config/index.js`. Lando service overrides come from the top-level `services:` block.
- **`lib/api.js#createApiToken` and `exchangeAuthorizationCode` must never be retried.** A lost response could create a duplicate API token whose one-time secret is lost; retrying a single-use authorization code after a lost response or 5xx replays a spent code.
- **Browser login redirect** must be exactly `http://127.0.0.1:<port>`; trailing slashes, paths and `localhost` are rejected.
- **API token creation needs a login from the last 5 minutes** (401 `insufficient_user_authentication`, `max_age=300`). `lib/login.js` sends `max_age=300` up front and retries once with the challenge's `max_age`/`amr`; a long-lived browser session alone is not enough.
- **Skip browser login with Enter only.** Escape leaks typed text into readline's next password answer. Hidden browser questions must keep `name: 'upsun-auth'` / `name: 'auth'` so explicit flags bypass them.
- **Console has no username-free API Tokens deep link.** Use `/-/users/<encoded-username>/settings/tokens` when known; otherwise use `/-/users/me/settings` and ask the user to select API Tokens.
- **Autoscan**: `plugin.yml` has `legacy: true`, so Lando picks up new files in `builders/`, `inits/`, `scripts/` and `app.js` automatically. Keep namespaced container helpers in `scripts/` and host-only maintainer scripts in `dev/`. Anything runtime-loaded must not be listed in `.npmignore` (currently `.github`, `docs`, `examples`, `test`, `dev/`).
- **`lib/mapping/version-tables.js` is generated.** Never hand-edit it; run `node dev/update-versions.js`. Runtime logic (`resolveVersion`, `getSupportedVersions`, `getVersionTableStatus`) lives in `lib/mapping/versions.js`, which the generator does not touch.
- **`lib/mapping/upsun-registry.js` is generated.** Never hand-edit it; run `node dev/update-upsun-registry.js`. The registry is never fetched at runtime. Unverified pins preserve existing compose tags; lifecycle checks skip unknowns, composable apps and replicas.
- **Env values are stringified by Lando**: never put `undefined` in a tooling `env` block; it reaches the container as the literal string `"undefined"`. See `getCliEnv` in `lib/cli.js`, which only sets keys that have values.
- **`pre-start` @3 Traefik priorities**: core normalizes proxy entries at `pre-start` @1. Traefik's default rule-length priority prefers a wildcard `HostRegexp` over an exact host, so `app.js` sorts routes (exact before wildcard, shorter before longer) and writes explicit `traefik.http.routers.<id>[-secured].priority` labels via an extra compose service, then re-dumps `app.compose`. Keep it after @1.
- **`ready` @0** must stay before core's `ready` @1, or `lando ssh` defaults to the wrong service.
- **`examples/**/README.md` are executable Leia specs**; edits there change CI behavior.
- **`@lando/*` peerDependencies are all optional.** The mapper reads installed plugins at runtime; missing or stale ones surface as `plugin-missing` / `plugin-outdated` warnings (`lib/mapping/versions.js`, `lib/warnings.js`), not install errors.
- **Magento layout**: `pull`, `push` and `switch` are replaced with `exit 1` stubs (`getMagentoTooling`); the builder skips the real sync tasks.
- `js-yaml` is on v4 (`^4.3.2`); the `!archive` / `!include` custom tags in `lib/config/yaml.js` use the v4 `DEFAULT_SCHEMA.extend` API.
- `docs/architecture.md` documents module contracts (Model, environment, mapping, routes, scripts). If you change a contract, change the doc in the same PR.

## Writing
- Commit messages, PR descriptions and issue comments: short and concise. No AI attribution.
- User-facing changes only in `CHANGELOG.md` under `## {{ UNRELEASED_VERSION }}`; past-tense bullets (`Added`, `Fixed`, `Renamed`), matching the existing style. Internal-only changes (tests, this file) get no entry.
- Docs are VitePress under `docs/`; sidebar in `docs/.vitepress/config.mjs`; `plugin.yml` `docs:` maps guides for the shared docs site.
