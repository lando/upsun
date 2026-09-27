# Lando Upsun Plugin

Run [Upsun](https://upsun.com/) projects locally with [Lando](https://lando.dev).

The plugin reads your Upsun configuration — Flex (`.upsun/config.yaml`) or
Fixed (`.platform.app.yaml` + `.platform/`) — builds the matching Lando
services, and gives your app the same runtime contract it gets on Upsun:
`PLATFORM_*` variables, provisioned relationships, hooks and operations, real
redirects, Mailpit, optional cron and tether modes, the `upsun` CLI, and
`lando pull` / `lando push`.

## Install

```bash
lando plugin-add @lando/upsun
```

## Use

```yaml
# .lando.yml, next to .upsun/ or .platform/
name: my-project
recipe: upsun
```

```bash
lando start
lando pull
```

Or clone from Upsun: `lando init --source upsun`.

## Docs

* [Documentation](https://docs.lando.dev/upsun)
* [Examples](https://github.com/lando/upsun/tree/main/examples)
* [Architecture](./docs/architecture.md)

## Examples

`examples/` holds Leia-tested projects: `flex-php`, `flex-node`, `flex-static`,
`flex-composable`, `flex-multiapp`, `flex-services`, `fixed-php` and
`fixed-magento`.

## Development

```bash
npm install
npm test
```

## Support

* [Issues](https://github.com/lando/upsun/issues/new)
* [Slack](https://www.launchpass.com/devwithlando)
