# Upsun Lando Plugin

This is the _official_ [Lando](https://lando.dev) plugin for [Upsun](https://upsun.com/) (formerly Platform.sh). When installed it...

* Runs Upsun Flex (`.upsun/config.yaml`) and Upsun Fixed (`.platform.app.yaml` + `.platform/`) projects, including Adobe Commerce Cloud
* Builds every application and service in your Upsun config, with the same `PLATFORM_*` variables and relationships your app gets on Upsun
* Runs your mounts, hooks, workers and crons the way Upsun does
* Serves your routes and redirects on local `*.lndo.site` URLs and catches outgoing mail with Mailpit
* Pulls and pushes databases and files with `lando pull` and `lando push`, or tethers your app to a remote environment's services
* Adds the Upsun CLI (`upsun`, or `platform` for Fixed projects), `lando db-import` / `lando db-export`, and Xdebug toggles

Of course, once you're running your Upsun project with Lando you can take advantage of [all the other awesome development features](https://docs.lando.dev) Lando provides.

## Basic Usage

Add a Landofile next to your `.upsun/` or `.platform/` directory:

```yaml
name: my-project
recipe: upsun
```

Then start the app and grab your data:

```bash
lando start
lando pull
```

Starting from a project that only exists on Upsun? `lando init --source upsun` clones it and writes the Landofile for you.

For more info you should check out the [docs](https://docs.lando.dev/upsun):

* [Getting Started](https://docs.lando.dev/upsun/getting-started.html)
* [Configuration](https://docs.lando.dev/upsun/config.html)
* [Tooling](https://docs.lando.dev/upsun/tooling.html)
* [Syncing](https://docs.lando.dev/upsun/sync.html)
* [Tethering](https://docs.lando.dev/upsun/tether.html)
* [Examples](https://github.com/lando/upsun/tree/main/examples)

## Installation

```bash
lando plugin-add @lando/upsun
```

## Issues, Questions and Support

If you have a question or would like some community support we recommend you [join us on Slack](https://launchpass.com/devwithlando).

If you'd like to report a bug or submit a feature request then please [use the issue queue](https://github.com/lando/upsun/issues/new/choose) in this repo.

## Changelog

We try to log all changes big and small in both [THE CHANGELOG](https://github.com/lando/upsun/blob/main/CHANGELOG.md) and the [release notes](https://github.com/lando/upsun/releases).

## Development

* Requires [Node 20+](https://nodejs.org/dist/latest-v20.x/)

```bash
git clone https://github.com/lando/upsun.git && cd upsun
npm install
```

See [Development](https://docs.lando.dev/upsun/development.html) and [Architecture](https://docs.lando.dev/upsun/architecture.html) for how the plugin is put together.

## Testing

```bash
# Lint the code
npm run lint

# Lint and run the unit tests
npm test

# Run the Leia tests in examples/ (needs Docker)
npm run test:leia
```

## Releasing

Publish a GitHub release. The release workflow publishes it to npm, and prereleases go out under the `edge` tag.
