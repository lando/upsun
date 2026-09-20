## v1.0.0-alpha.1 - Unreleased

* Rewrote the runtime: Upsun configuration is translated onto Lando's own service plugins (php, node, python, ruby, go, mariadb, mysql, postgres, redis, memcached, mongo, solr, elasticsearch, varnish) and official images for opensearch, valkey, rabbitmq, kafka, influxdb, chrome-headless, gotenberg and clickhouse. The Platform.sh image runtime (privileged containers, fake RPC agent, OPEN protocol, `docker.registry.platform.sh`) is gone.
* Upsun Flex (`.upsun/*.yaml`) is supported alongside Upsun Fixed (`.platform*`); mixed repositories are rejected. All relationship forms, `source.root` multi-app, composable images (primary runtime), mounts, hooks, crons, workers and `.environment` are handled.
* Full `PLATFORM_*` runtime contract plus per-relationship service variables (`DATABASE_HOST`, `DATABASE_URL`, ...).
* The `upsun` (Flex) or `platform` (Fixed) CLI is installed in the app container; `lando pull` / `lando push` use it with `UPSUN_CLI_TOKEN` / `PLATFORMSH_CLI_TOKEN`; `lando init --source upsun|platformsh` clones with `<cli> get`.
* Generated tooling: language commands, relationship shells (`lando database`, ...), `lando cron <name>`, `lando upsun` / `lando platform`.
* PHP nginx vhosts are rendered from `web.locations` (passthru, allow, scripts, rules, expires, headers); `build.flavor` runs `composer install` / `npm install` before the build hook; `lando drush` is added for Drupal projects; tooling and `lando ssh` source `.environment`; `jq` is installed for Upsun's `.environment` templates.
* Examples `flex-php`, `flex-node` and `fixed-php`, all verified live; Leia runs on `3-stable` and `3-edge`. The Upsun Drupal 11 scaffold installs and runs end to end.

## v1.0.0-alpha.0 - [September 4, 2026](https://github.com/AaronFeledy/upsun)

* Rebrand package/recipe to `@lando/upsun` / `upsun` (deprecated `platformsh` alias).
* Fixed-only: Flex (`.upsun/config.yaml`) is a hard error until Phase 3.
* Token cache `upsun.tokens` with read-old-write-new from `platformsh.tokens`.
* Keep `platform` CLI, `PLATFORMSH_CLI_TOKEN`, and `platformsh-client@0.1.230` (auth path, code).
* OPEN / `PLATFORM_RELATIONSHIPS` runtime deferred until a live Docker proof.
* Seed: lando/platformsh tip `9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0` (50 commits ahead of tag `v0.10.0`; seed `package.json` said `0.9.0`).

## v0.10.0 - [March 8, 2024](https://github.com/lando/platformsh/releases/tag/v0.10.0)
  * Updated to latest database services.

## v0.9.0 - [July 3, 2023](https://github.com/lando/platformsh/releases/tag/v0.9.0)
  * Removed bundle-dependencies and version-bump-prompt from plugin.
  * Updated package to use prepare-release-action.
  * Updated documentation to reflect new release process.

## v0.8.0 - [April 20, 2023](https://github.com/lando/platformsh/releases/tag/v0.8.0)

* Updated to `platformsh-client` 0.1.230 and pinned to that release to resolve issue with fetching site list. [#184](https://github.com/lando/platformsh/issues/184)

## v0.7.0 - [December 12, 2022](https://github.com/lando/platformsh/releases/tag/v0.7.0)

* Added bundle-dependencies to release process.
* Fixed bug in plugin dogfooding test.

## v0.6.1 - [September 8, 2022](https://github.com/lando/platformsh/releases/tag/v0.6.1)

* HYPERDRIVED

## v0.6.0 - [October 29, 2021](https://github.com/lando/platformsh/releases/tag/v0.6.0)

Lando is **free** and **open source** software that relies on contributions from developers like you! If you like Lando then help us spend more time making, updating and supporting it by [contributing](https://github.com/sponsors/lando).

* Updated to more recent `php` images, resolves [#23](https://github.com/lando/platformsh/issues/23) [#60](https://github.com/lando/platformsh/issues/60) [#116](https://github.com/lando/platformsh/issues/116)

## v0.5.0 - [October 6, 2021](https://github.com/lando/platformsh/releases/tag/v0.5.0)

Lando is **free** and **open source** software that relies on contributions from developers like you! If you like Lando then help us spend more time making, updating and supporting it by [contributing](https://github.com/sponsors/lando).

* First release of `platformsh` as an external plugin!
* Added testing for most `services` [#3](https://github.com/lando/platformsh/issues/3)
* Fixed some bugs
