# AGENTS.md

## Overview

`@lando/upsun` is a Lando v3 recipe plugin (`recipe: upsun`) that runs Upsun Flex, Upsun Fixed and Adobe Commerce Cloud projects locally. It reads the project's Upsun config, translates it into Lando services, sets the `PLATFORM_*` environment, runs hooks/mounts/crons on start, and wires `lando pull` / `push` / `switch` / `tether` through the Upsun CLI.

- Node >= 20, CommonJS (`'use strict'` + `require`).
- Tests: mocha + chai (`chai.should()`), coverage via nyc.
- Lint: ESLint 9 flat config (`eslint.config.js`) with `eslint-config-google` and `eslint-plugin-jsdoc`.
- JSDoc uses **`@returns`**, not `@return`. Pantheon and core use `@return`; do not "fix" this repo to match them (`jsdoc/check-tag-names` defines `returns`).

## Maintenance
- Keep this file up to date. If you identify a serious repo-specific gotcha that is likely to trip future agents, update this file in the same change.

## Commands
- `npm run lint`: ESLint.
- `npm run test:unit`: all unit tests with nyc coverage.
- `npm test`: lint + unit tests. Run before finishing any change.
- `npm run test:leia`: Leia integration tests over `examples/**/README.md`. **CI-only, do not run locally**: it starts real containers and modifies the host.
- `npm run typecheck`: `tsc` over `jsconfig.json`, node_modules errors filtered, never fails. Not gated in CI. `npm run typecheck:full` includes node_modules.
- `npm run docs:dev` / `docs:build` / `docs:preview`: VitePress docs in `docs/`.
- Single spec: `npx mocha --timeout 5000 test/<file>.spec.js`.
- `node scripts/update-versions.js`: regenerates `lib/mapping/version-tables.js` (data only) from installed plugins in `~/.lando/plugins/@lando` (override with `LANDO_PLUGINS_DIR`; output path with `UPSUN_VERSIONS_OUTPUT`). Commit the result.

## Architecture

Pipeline (pure modules first, glue last). `docs/architecture.md` and `docs/lifecycle.md` are the authoritative contracts; update them when behavior changes.

1. `lib/config/`: `detect(root)` picks the flavor/layout, then `flex.load` or `fixed.load` reads YAML, then `normalize` produces the pure Model (`{flavor, layout, root, configFiles, applications, services, routes, ...}`). `index.js` exports `detect` and `load`. `relationships.js` resolves app/service relationships; `yaml.js` handles the custom YAML types.
2. `lib/mapping/`: Model to Lando v3 service definitions. `runtimes.js` (application containers, `RUNTIME_TYPES`), `services.js` (data services: Lando plugins plus a `COMPOSE` table for raw images, Mailpit), `versions.js` (generated version tables, `resolveVersion`, `getSupportedVersions`, `getVersionTableStatus`), `database.js` (schema/user/grant init), `php.js` (extensions, ini).
3. `lib/env.js`: builds the `PLATFORM_*` runtime environment (base64 JSON payloads, canonicalized ordering). `lib/routes.js` + `lib/domains.js`: routes to Lando proxy config and local hosts. `lib/nginx.js`: web location config.
4. `lib/hooks.js`: start command list (mounts, db init, `pre_start`, `post_start`, `deploy`, `post_deploy`, tether). `lib/project.js`: reads the project id from `.upsun/local/project.yaml` or `.platform/local/project.yaml`. `lib/workspace.js`: repo/branch and workspace helpers.
5. `builders/upsun.js`: the recipe builder. Orchestrates everything above, generates tooling, and stashes results on `app.upsun` (`model, flavor, cli, closestApp, closestType, hostMap, branch, projectId, tethered, tetherEnvironment, mail, startCommands, warnings`). `app.js` and `index.js` read from that object.
6. `app.js`: per-app lifecycle events (only when `utils.isUpsunRecipe`):
   - sets `app.id` from `config.id`; warns on deprecated `recipe: platformsh`
   - `post-init`: forwards `app.upsun.warnings` via `lib/warnings.js`
   - `post-info`: marks the closest app `tethered` in `lando info`
   - `pre-start` @3: adds a `upsun-proxy-priorities` compose service with Traefik router priorities (see Gotchas)
   - `post-start` @101: runs `app.upsun.startCommands` through `app.engine.run` (`buildRunCommands`); failure adds a warning message
   - `ready` @0: sets `app._defaultService` to the closest app before core bakes the ssh default at `ready` @1
   - `post-pull` / `post-push`: validates `--auth` via `getAccountInfo` and caches the token
7. `index.js`: global Lando events. `cli-{pull,push,switch}-answers` drops a cached token Upsun rejects; `cli-ssh-run` retargets `appserver` to the primary service and wraps the command in `/helpers/upsun-exec.sh` so `.environment` is sourced.

Tooling and sync: `lib/tooling.js` (language tooling, relationship shells, `getMagentoTooling`), `lib/pull.js`, `lib/push.js`, `lib/switch.js` build tooling tasks that call the bash scripts.

Auth: `lib/api.js` (native `fetch`, no HTTP library), `lib/tokens.js` (lando cache `upsun.tokens`, legacy `platformsh.tokens`, plus the CLI's own saved token file), `lib/auth.js` (init/pull prompts), `lib/cli.js` (`resolveCli`: flex uses the `upsun` binary and `UPSUN_CLI_TOKEN`; fixed uses `platform` and `PLATFORMSH_CLI_TOKEN`; `getCliEnv`, `getInstallStep`).

## Directory map

| Path | Purpose |
| --- | --- |
| `index.js` | Plugin entry; global `lando.events` hooks |
| `app.js` | App lifecycle hooks; `buildRunCommands` |
| `plugin.yml` | `legacy: true` autoscan plugin manifest; docs sidebar hints |
| `builders/upsun.js` | Recipe builder (the only builder) |
| `inits/upsun.js` | `lando init --source upsun` |
| `lib/config/` | detect, flex/fixed loaders, normalize, relationships, YAML types |
| `lib/mapping/` | Model to Lando services, versions, database init, PHP |
| `lib/*.js` | env, routes, domains, nginx, hooks, tooling, pull/push/switch, api, tokens, auth, cli, project, workspace, utils, warnings |
| `scripts/upsun-*.sh` | Container-side bash, mounted at `/helpers/` |
| `scripts/update-versions.js` | Dev-only generator for `lib/mapping/version-tables.js` (npmignored) |
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

| Script | Does |
| --- | --- |
| `upsun-env.sh` | Source to get an Upsun SSH-like shell env (`.environment` sourced, tether env loaded) |
| `upsun-exec.sh` | Run a command with that env; prefix for tooling and `lando ssh` |
| `upsun-start.sh` | Start-time sequencing (mounts, provisioning wait, hooks) |
| `upsun-hook.sh` | Run one hook (`build`/`deploy`/`post_deploy`) extracted from `PLATFORM_APPLICATION` |
| `upsun-operation.sh` | Run a runtime operation with the app env |
| `upsun-db-init.sh` | Create schemas, users and grants for MariaDB/MySQL/PostgreSQL |
| `upsun-cron.sh` / `upsun-crond.sh` | Run one cron job once / run the cron table with supercronic |
| `upsun-install-cli.sh` | Install the `upsun` or `platform` CLI from GitHub releases |
| `upsun-install-node.sh`, `upsun-install-supercronic.sh`, `upsun-php-extensions.sh` | Build-step installers |
| `upsun-xdebug.sh` | Toggle Xdebug |
| `upsun-sync-env.sh` | Shared pull/push/tether helpers: CLI selection, arg parsing, wake environment, parent fallback |
| `upsun-pull.sh`, `upsun-push.sh`, `upsun-switch.sh`, `upsun-tether.sh` | The sync tooling commands |

## Style

Enforced by `eslint.config.js` (google + jsdoc recommended):

- 2 spaces, single quotes, semicolons, `max-len` 120 (comments ignored), `arrow-parens: as-needed`. `indent` and `comma-dangle` rules are off.
- Every file starts with `'use strict';`.
- JSDoc is required on `FunctionDeclaration` only (not arrows, methods or classes). Use `@param {type} name` and `@returns {type}`; `jsdoc/check-types`, `check-param-names` and `valid-types` are errors, descriptions are optional.
- Types go in JSDoc; shared typedefs live in co-located `lib/**/*.types.js` files and are checked by `npm run typecheck`.
- Lodash is used in glue code (`builders/upsun.js`, `app.js`, `inits/upsun.js`, `lib/utils.js`, `lib/auth.js`, `lib/push.js`, `lib/switch.js`, `lib/workspace.js`, `lib/config/flex.js`). `lib/mapping/*`, `lib/env.js`, `lib/routes.js`, `lib/domains.js`, `lib/cli.js`, `lib/tokens.js`, `lib/api.js` are lodash-free by design; keep them that way.
- `_` is a declared global in the lint config; still `require('lodash')` explicitly where used.

## Adding or changing a service mapping

1. Lando-plugin-backed services: edit `lib/mapping/services.js`; refresh version tables with `node scripts/update-versions.js`.
2. Raw-image services: add an entry to the `COMPOSE` table in the same file.
3. Add a case to `test/mapping-services.spec.js`. If user-visible, add an example under `examples/` with a Leia `README.md` and a CHANGELOG bullet.
4. Update the mapping contract in `docs/architecture.md`.

## Testing conventions

- Pure unit tests over `lib/` against fixtures; `builders/upsun.js`, `app.js`, `index.js` are glue and tested with fake `app`/`lando` objects.
- Builder tests (`test/builder.spec.js`) call `recipe.builder(MockRecipe, recipe.config)` with a tiny `MockRecipe` parent that captures `options`.
- Bash scripts are tested by running them: `execFileSync('bash', [script, ...])` with `UPSUN_*` env overrides and mock binaries from `test/fixtures/mock-*.sh` (often prepended to `PATH`). `test/fixtures/sync-harness.sh` sources `upsun-sync-env.sh` and exposes its functions; `test/fixtures/log.sh` stands in for `/helpers/log.sh`.
- Config fixtures: `test/fixtures/flex-*`, `fixed-*`, `mixed-*`, `no-apps`, `no-config`, `installers`, `plugins`.
- HTTP is stubbed by assigning `global.fetch` directly (no sinon/nock); restore it in `afterEach`.
- Temp dirs via `fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-...'))`.
- New spec files must match `test/**/*.spec.js`; nyc `include` covers `builders/`, `inits/`, `lib/`.

## Config and caches

- Detection (`lib/config/detect.js`): `.upsun/*.yaml` means Flex (`layout: upsun`); `.platform.app.yaml` + `.platform/` means Fixed (`layout: platform`, `platform` CLI); `.magento.app.yaml` + `.magento/` means Adobe Commerce Cloud (`flavor: fixed`, `layout: magento`). Mixing Flex and Fixed files, or Magento with either, is an error.
- Landofile: `recipe: upsun` (or deprecated `platformsh`); `config.id` sets the Upsun project id (`app.id`); when absent the builder falls back to `readLocalProjectId` and then `'lando'`. `config.xdebug` (default `false`), `config.mail` (default `true`, skipped if the project already defines a `mailpit` service) and `config.crons` (default `false`) feed the mapper.
- Token caches: lando cache keys `upsun.tokens` and legacy `platformsh.tokens`, plus `<app>.meta.cache` (`token`, `email`). The CLI's own saved token is also offered in the `--auth` picker.
- Generated tooling is cached by core. If a tooling or builder change seems ignored, run `lando --clear` before assuming the code path is wrong.

## Repo-Specific Gotchas

- **Autoscan**: `plugin.yml` has `legacy: true`, so Lando picks up new files in `builders/`, `inits/`, `scripts/` and `app.js` automatically. Anything runtime-loaded must not be listed in `.npmignore` (currently `.github`, `docs`, `examples`, `test`, `scripts/update-versions.js`).
- **`lib/mapping/version-tables.js` is generated.** Never hand-edit it; run `node scripts/update-versions.js`. Runtime logic (`resolveVersion`, `getSupportedVersions`, `getVersionTableStatus`) lives in `lib/mapping/versions.js`, which the generator does not touch.
- **Env values are stringified by Lando**: never put `undefined` in a tooling `env` block; it reaches the container as the literal string `"undefined"`. See `getCliEnv` in `lib/cli.js`, which only sets keys that have values.
- **`pre-start` @3 Traefik priorities**: core normalizes proxy entries at `pre-start` @1. Traefik's default rule-length priority prefers a wildcard `HostRegexp` over an exact host, so `app.js` sorts routes (exact before wildcard, shorter before longer) and writes explicit `traefik.http.routers.<id>[-secured].priority` labels via an extra compose service, then re-dumps `app.compose`. Keep it after @1.
- **`ready` @0** must stay before core's `ready` @1, or `lando ssh` defaults to the wrong service.
- **`examples/**/README.md` are executable Leia specs**; edits there change CI behavior.
- **`@lando/*` peerDependencies are all optional.** The mapper reads installed plugins at runtime; missing or stale ones surface as `plugin-missing` / `plugin-outdated` warnings (`lib/mapping/versions.js`, `lib/warnings.js`), not install errors.
- **Magento layout**: `pull`, `push`, `switch` and `tether` are replaced with `exit 1` stubs (`getMagentoTooling`); the builder skips the real sync tasks.
- `js-yaml` is on v4 (`^4.3.2`); the `!archive` / `!include` custom tags in `lib/config/yaml.js` use the v4 `DEFAULT_SCHEMA.extend` API. The "keep js-yaml on v3" note in `docs/development.md` is stale; fix the doc rather than downgrading.
- `docs/architecture.md` documents module contracts (Model, environment, mapping, routes, scripts). If you change a contract, change the doc in the same PR.

## Writing
- Commit messages, PR descriptions and issue comments: short and concise. No AI attribution.
- User-facing changes only in `CHANGELOG.md` under `## {{ UNRELEASED_VERSION }}`; past-tense bullets (`Added`, `Fixed`, `Renamed`), matching the existing style. Internal-only changes (tests, this file) get no entry.
- Docs are VitePress under `docs/`; sidebar in `docs/.vitepress/config.mjs`; `plugin.yml` `docs:` maps guides for the shared docs site.
