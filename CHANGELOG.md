## v1.0.0-alpha.1 - Unreleased

* Translated Upsun Flex and Fixed configuration onto Lando service plugins and official upstream images.
* Based local route hosts on the Lando app name, added real Traefik 301 redirect routes, and mapped `redirects.paths` including temporary and regexp redirects.
* Parsed composable `stack.runtimes` / `stack.packages`, used the first declared runtime, and installed a secondary Node.js runtime beside PHP.
* Provisioned MariaDB/MySQL and PostgreSQL schemas, endpoint users and privileges on every start, with `upsun` passwords for PostgreSQL users.
* Added the non-PHP start wrapper and a `post-start` every-start runner for mounts, database initialization, deploy hooks, `pre_start`, `post_start`, `post_deploy` and tether setup.
* Added PHP extension enable/disable handling, `variables.php` rendering, root `php.ini` linking, and `lando xdebug-on [mode]` / `lando xdebug-off`.
* Added an nginx sidecar for non-PHP `web.locations`, including static sites without an app start command.
* Installed declared Node.js, PHP, Python and Ruby dependencies before the build flavor and build hook.
* Added `PLATFORM_PRE_APP_COMMAND`, `PLATFORM_APP_COMMAND`, `PLATFORM_POST_APP_COMMAND`, `TZ`, and `additional_hosts` support.
* Added Mercure, Chroma and Qdrant service mappings plus Valkey relationship tooling.
* Added Mailpit by default: service `mailpit`, SMTP on port 25, `PLATFORM_SMTP_HOST=mailpit`, PHP sendmail integration, and a `mail.<name>.<domain>` UI. `config.mail: false` disables it.
* Added `lando operation <name>` for runtime operations.
* Read `config.id` from the local project file and supported `lando init` from the current working directory.
* Added the opt-in `<app>--cron` Supercronic sidecar through `config.crons`, while keeping `lando cron <name>`.
* Added pull/push `--skip-db`, `--skip-files` and `-A/--app`, pull `--all-mounts`, and gzip-streamed pull database dumps.
* Added tether mode through `config.tethered`, relationship tunnels, PHP-FPM environment reloads, and `lando tether --info|--close`.
* Read supported version tables from installed Lando plugins, with generated tables as fallback.
* Added `flex-multiapp`, `flex-composable` and `flex-static` examples alongside the existing Flex PHP, Flex Node.js and Fixed PHP examples.
* Resolved relationships to other applications onto the target app's local HTTP service, and skipped unresolvable targets with a `relationship-unresolved` warning instead of failing.
* Kept a null relationship path for endpoints without `default_schema` / `default_database`, omitted `<REL>_PATH`, and added the `relationship-path-null` warning.
* Created every PostgreSQL database listed in `configuration.databases`.
* Reordered the every-start runner to mounts, database initialization or tether, provisioned marker, `pre_start`, `post_start`, `deploy`, `post_deploy`, and made non-PHP apps with a SQL relationship wait for provisioning (`UPSUN_PROVISION_WAIT`, `/dev/shm/upsun-provisioned`).
* Reported failed start commands as a warning while making `lando start` exit nonzero.
* Failed the tether with exit 5, closed opened tunnels and wrote no environment file when a relationship tunnel never opens.
* Verified installer downloads against published checksums (`upsun/cli` `checksums.txt`, Node.js `SHASUMS256.txt`, pinned Supercronic 0.2.49 SHA-1) and exit 6 on mismatch; installed the CLI from the maintained `upsun/cli` releases.
* Let Landofile `env_file` values win over `variables.env` by omitting those keys from the promoted variables.
* Added `config.domains` to expand `{all}` routes onto `<label>.<name>.<domain>` hosts, with paired redirects and `{default}` winning collisions.
* Added `lando db-import` and `lando db-export` for SQL relationships.
* Gave exact route hosts priority over wildcard routes such as `https://*.{default}/` in the Lando proxy.
* Detected Adobe Commerce Cloud projects (`.magento.app.yaml`, `.magento/services.yaml`, `.magento/routes.yaml`), mirrored `PLATFORM_*` as `MAGENTO_CLOUD_*`, and replaced `pull`, `push` and `tether` with `magento-cloud` guidance.
* Matched Upsun's composer build flavor command exactly (`composer --no-ansi --no-interaction install --no-progress --prefer-dist --optimize-autoloader`).
* Started compose-backed services with their image entrypoint and command, fixing OpenSearch, RabbitMQ, Kafka, InfluxDB and similar services that never came up.
* Added `fixed-magento` and `flex-services` examples.

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
