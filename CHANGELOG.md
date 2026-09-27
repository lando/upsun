## {{ UNRELEASED_VERSION }} - [{{ UNRELEASED_DATE }}]({{ UNRELEASED_LINK }})

* Renamed the plugin to `@lando/upsun` and the recipe to `upsun`. `recipe: platformsh` and the `--platformsh-auth` / `--platformsh-site` init options still work as deprecated aliases, and saved `platformsh.tokens` are picked up automatically.
* Added Upsun Flex (`.upsun/config.yaml`) alongside Upsun Fixed (`.platform.app.yaml` + `.platform/`), including multiple applications and composable images.
* Added Adobe Commerce Cloud projects (`.magento.app.yaml` + `.magento/`) with `MAGENTO_CLOUD_*` variables. `lando pull`, `lando push` and `lando tether` aren't available for them.
* Replaced the frozen `docker.registry.platform.sh` images with Lando's own service plugins and official upstream images.
* Mapped services onto Lando's MariaDB, MySQL, PostgreSQL, Redis, Memcached, MongoDB, Solr, Elasticsearch and Varnish plugins, and official images for OpenSearch, Valkey, RabbitMQ, Kafka, InfluxDB, ClickHouse, Chrome Headless, Gotenberg, Mercure, Chroma and Qdrant.
* Provisioned MariaDB, MySQL and PostgreSQL schemas, endpoint users and grants, and added relationships between applications.
* Set the `PLATFORM_*` runtime variables the way Upsun does. Landofile `env_file` values override `variables.env`.
* Ran mounts, database setup, `pre_start`, `post_start`, `deploy` and `post_deploy` on every start in Upsun's order. A failing hook makes `lando start` exit nonzero.
* Added PHP extension and `php.ini` handling, `variables.php`, declared dependencies, workers, and an nginx sidecar for non-PHP `web.locations` and static sites.
* Served routes on hosts based on the Landofile `name`, with real redirects including `redirects.paths`. Exact hosts win over wildcard routes, and `config.domains` gives `{all}` routes one local host per domain.
* Added Mailpit for outgoing mail. Set `config.mail: false` to turn it off.
* Added an opt-in cron sidecar through `config.crons`, plus `lando cron <name>` and `lando operation <name>`.
* Added `lando db-import`, `lando db-export`, and `lando xdebug-on` / `lando xdebug-off`.
* Added `--skip-db`, `--skip-files` and `-A/--app` to `lando pull` and `lando push`, `--all-mounts` to `lando pull`, and gzip-compressed database dumps.
* Added tether mode through `config.tethered` and `lando tether`, which connects your local app to a remote environment's services.
* Read the project ID from the local Upsun project file and supported `lando init` from an existing checkout.
* Installed the matching CLI (`upsun` with `UPSUN_CLI_TOKEN` for Flex, `platform` with `PLATFORMSH_CLI_TOKEN` for Fixed) and verified CLI, Node.js and Supercronic downloads against published checksums.
* Rewrote the docs and added Leia-tested examples for Flex, Fixed, multi-app, composable, static, services and Adobe Commerce projects.

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
