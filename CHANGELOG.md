## {{ UNRELEASED_VERSION }} - [{{ UNRELEASED_DATE }}]({{ UNRELEASED_LINK }})
* Added readiness-only retries for busy Upsun environments every 30 seconds for up to ten minutes, with terminal countdowns and readable piped progress.
* Loaded Xdebug with the app's `runtime.xdebug.idekey` like Upsun does; `config.xdebug` still forces it on or off.
* Fixed `runtime.extensions: [xdebug]` failing the build and every later start: extensions the Lando PHP image ships disabled are now enabled instead of reinstalled.
* Fixed `lando xdebug-on` having no effect because the container's `XDEBUG_MODE` overrode it; the toggles now apply to web requests and `lando php` alike. `lando xdebug-off` keeps Xdebug 3 loaded with the mode off and unloads legacy Xdebug 2.
* Fixed explicitly disabled Xdebug being re-enabled during the PHP build and failed PHP inspection being reported as a successful toggle.
* Added a [Debugging with Xdebug](https://docs.lando.dev/upsun/xdebug.html) guide.
* Fixed workers inheriting the web application's start and pre-start commands.
* Fixed static-site passthroughs such as `/index.html` proxying to an application with no start command.
* Fixed name-keyed `applications.yaml` maps loading as a single application in Fixed and Adobe Commerce projects.
* Fixed `PLATFORM_ROUTES`: `upstream` is the application name, configured `attributes` are kept, boolean `ssi` is normalized, and the implicit primary route is the first defined upstream.
* Fixed wildcard redirect routes such as `*.{default}` not matching subdomains.
* Fixed Landofile `env_file` keys written as `KEY: value` or bare `KEY` not overriding `variables.env`.
* Added clear errors for invalid `web.locations` values, roots outside the application directory, circular YAML includes and invalid route/redirect definitions.
* Fixed multi-PHP projects routing requests to the wrong application.
* Fixed Python, Ruby and Go workers and cron sidecars generating invalid Compose port definitions.
* Changed database grants to match Upsun endpoint privileges (MySQL/MariaDB `ro`/`rw` sets; PostgreSQL `rw` is DML-only and `ro` can read sequences), reapplied them on every restart, and limited the PostgreSQL superuser to the default endpoint of a service without configured endpoints.
* Removed invented MongoDB relationship credentials; local MongoDB runs without authentication.
* Changed InfluxDB 3+ to be skipped with a warning instead of starting a broken container.
* Added warnings for collapsed Solr cores, ignored Redis/Valkey configuration, unsupported PHP web start commands, Unix-socket upstreams and Python dependencies without a local Python runtime.
* Preserved exact `composer/composer` versions and installed Node.js for PHP apps that declare `dependencies.nodejs`.
* Fixed relationship shell quoting and moved the MySQL password off the command line.
* Fixed `lando pull`/`push`/`switch` injecting a cached API token other than the selected one into the container environment.
* Fixed `--no-db=true` and `--no-files=true` not skipping sync.
* Fixed browser login hanging when the browser closed its callback connection, used the account that completed a step-up login, stopped copying the CLI's own token into Lando's cache, and offered the active CLI session's token in `--auth`.
* Changed `lando push` to pre-select no database relationships and take a remote MySQL/MariaDB safety dump before importing, with a restore command on failure.
* Fixed successful pull/push/switch commands failing when the account refresh could not reach Upsun.
* Fixed `recipe: platformsh` not resolving to the recipe, `lando ssh` wrapping non-application services on the cached path, and `lando init` in an existing Fixed checkout caching the token under the wrong vendor.
* Fixed PostgreSQL pulls mangling dollar-quoted function bodies and multiline extension comments, and failing on repeat pulls when functions, types or large objects already exist.
* Fixed the npm package including coverage output.
* Kept MariaDB/MySQL pull backups outside temporary import directories so Ctrl-C and SIGTERM preserve a reported recovery copy.
* Refused unforced pushes when the remote environment type could not be verified as development or staging.
* Made PostgreSQL pushes replace objects in one error-stopping transaction without local owners, grants or extension changes.
* Stopped sync from guessing a parent environment when its lookup failed or returned no parent.
* Propagated pipeline failures in hook, operation, cron and pre_start bodies.
* Fixed compound dependency constraints being interpreted as shell commands, and ran automatic Composer/npm builds in each application's source directory.
* Fixed routes to Varnish and other HTTP services, relative redirects on subdomains, and worker-specific runtime relationships.
* Kept nginx location `rules` scoped to their parent location, inheriting its root, headers and `allow`/`scripts` settings.
* Stopped rejected CLI tokens from being imported again until successfully saved, and added a 30-second deadline to API requests and response reads without retrying token creation or authorization-code exchange.
* Hardened generated config filenames, YAML includes and archives, PHP extension names, secondary runtime versions and shell-controlled source and mount paths.
* Extended PostgreSQL default privileges to objects created by each schema's admin and writer endpoints.
* Pinned raw-image services to verified multi-arch tags for Upsun's upstream versions, fixing missing tags such as `apache/kafka:4.3`.
* Added warnings for app runtimes and services Upsun marks deprecated, retired or decommissioned.
* Stopped browser login from retrying its single-use authorization code after a failed token exchange.
* Made MariaDB/MySQL pulls back up the local database first and restore it if the import fails.
* Fixed PostgreSQL pulls stopping on extensions for named non-superuser endpoints by running extension statements as the local `postgres` superuser.
* Kept `valkey-persistent` data in a named volume with append-only writes.
* Shell-quoted the API token and project ID in the `lando init` clone command, and escaped schema and endpoint names in database setup SQL.
* Mapped read-only database replicas onto their primaries without extra containers, excluded and rejected replica relationships in pull/push/switch, and fixed null endpoints for `clickhouse`, `gotenberg`, `redis-persistent`, `valkey-persistent`, `mongodb-enterprise` and `elasticsearch-enterprise`.
* Pre-selected the first option in the `lando pull` database and mount prompts.
* Fixed `lando pull` and `push` treating a paused environment as active instead of resuming it. Pull falls back to the parent only when the wake fails (`--env` or `--no-parent` disables it); push never falls back; unknown, dirty, deleting or unreadable statuses stop the command.
* Restored `config.overrides` and `config.variables` as raw Upsun config merged before mapping; override generated Lando services from the top-level `services:` block instead.
* Generated tooling for every app in a multi-app project and routed commands by the directory they run from, with the closest app (or `config.app`) as the fallback.
* Reused the app's saved account for `lando pull`, `push` and `switch` without prompting, and refreshed cached tooling when a token is saved or rejected.
* Made the `lando switch` environment optional with an interactive picker, and accepted it as `--env`/`-e`.
* Added `--no-db`/`--no-files` as aliases for `--skip-db`/`--skip-files`, and `-r NAME:DATABASE` to target a specific database locally and remotely.
* Made database pulls replace local data safely: dumps are checked before anything is dropped, PostgreSQL imports run in one transaction (large objects included) without the remote project's grants, and empty prompt selections are reported instead of silently skipped.
* Fixed `hooks.build` running the project's own `vendor/bin/composer`, which crashed `composer install --no-dev` when dev dependencies were already installed.
* Added `lando auth upsun` to log in to Upsun and save an API token for an existing app without pulling.
* Skipped the clone in `lando init --source upsun` / `platformsh` when the folder already has Upsun config, and set `config.id` from the chosen project.
* Added a browser login to `lando init` and the `lando pull`/`push`/`switch` account picker that creates an API token for you. Press Enter to skip it and paste a token instead.
* Added `lando switch <environment>` to check out an Upsun environment's branch and pull its databases and mounts.
* Removed cached API tokens that Upsun rejects, and offered the token saved by the `upsun`/`platform` CLI in the `--auth` picker.
* Declared optional `@lando/*` service plugin version floors and warned when a needed plugin is missing or older than the bundled version tables.
* Documented arm64 support for compose-only services and how to pin an image tag when an Upsun version has no matching Docker tag.
* Renamed the plugin to `@lando/upsun` and the recipe to `upsun`. `recipe: platformsh` and the `--platformsh-auth` / `--platformsh-site` init options still work as deprecated aliases, and saved `platformsh.tokens` are picked up automatically.
* Added Upsun Flex (`.upsun/config.yaml`) alongside Upsun Fixed (`.platform.app.yaml` + `.platform/`), including multiple applications and composable images.
* Added Adobe Commerce Cloud projects (`.magento.app.yaml` + `.magento/`) with `MAGENTO_CLOUD_*` variables. `lando pull`, `lando push` and `lando switch` aren't available for them.
* Replaced the frozen `docker.registry.platform.sh` images with Lando's own service plugins and official upstream images.
* Mapped services onto Lando's MariaDB, MySQL, PostgreSQL, Redis, Memcached, MongoDB, Solr, Elasticsearch and Varnish plugins, and official images for OpenSearch, Valkey, RabbitMQ, Kafka, InfluxDB, ClickHouse, Chrome Headless, Gotenberg and Mercure.
* Provisioned MariaDB, MySQL and PostgreSQL schemas, endpoint users and grants, and added relationships between applications.
* Set the `PLATFORM_*` runtime variables the way Upsun does. Landofile `env_file` values override `variables.env`.
* Ran mounts, database setup, `pre_start`, `post_start`, `deploy` and `post_deploy` on every start in Upsun's order. A failing hook makes `lando start` exit nonzero.
* Added PHP extension and `php.ini` handling, `variables.php`, declared dependencies, workers, and an nginx sidecar for non-PHP `web.locations` and static sites.
* Served routes on hosts based on the Landofile `name`, with real redirects including `redirects.paths`. Exact hosts win over wildcard routes, and `config.domains` gives `{all}` routes one local host per domain.
* Added Mailpit for outgoing mail. Set `config.mail: false` to turn it off.
* Added an opt-in cron sidecar through `config.crons`, plus `lando cron <name>` and `lando operation <name>`.
* Added `lando db-import`, `lando db-export`, and `lando xdebug-on` / `lando xdebug-off`.
* Added `--skip-db`, `--skip-files` and `-A/--app` to `lando pull` and `lando push`, `--all-mounts` to `lando pull`, and gzip-compressed database dumps.
* Read the project ID from the local Upsun project file and supported `lando init` from an existing checkout.
* Installed the matching CLI (`upsun` with `UPSUN_CLI_TOKEN` for Flex, `platform` with `PLATFORMSH_CLI_TOKEN` for Fixed) and verified CLI, Node.js and Supercronic downloads against published checksums.
* Retried transient network failures when downloading the Upsun CLI, Node.js, Supercronic and apt packages, and on Upsun API calls.
* Dropped the `platformsh-client` dependency for a direct API call, so `lando init` now reports a bad API token instead of hanging, and updated `tar`, `js-yaml` and `lodash` to clear known security advisories.
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
