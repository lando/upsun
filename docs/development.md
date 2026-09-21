---
title: Development
description: Work on the Lando Upsun plugin.
---

# Development

Requires Node 20, Lando 3.21+, Bash and `jq`. The shell-script tests invoke Bash
and use `jq` on the host.

```bash
git clone https://github.com/lando/upsun.git && cd upsun
npm install
npm test            # lint + unit tests
npm run test:leia   # integration tests in examples/
```

Point an app at your checkout with a `.lando.local.yml`:

```yaml
plugins:
  "@lando/upsun": /path/to/upsun
```

## Layout

See [Architecture](./architecture.md). The pure modules (`lib/config`,
`lib/env.js`, `lib/mapping`, `lib/routes.js`) are unit tested against fixtures
in `test/fixtures`; `builders/upsun.js`, `app.js` and `index.js` only glue.

## Adding or updating a service mapping

- Bundled Lando plugins: edit `lib/mapping/services.js` and refresh the version
  tables with `node scripts/update-versions.js`. The generator reads installed
  plugins from `LANDO_PLUGINS_DIR`, defaulting to `~/.lando/plugins/@lando`.
- Other images: add an entry to the `COMPOSE` table in the same file.
- Add a case to `test/mapping-services.spec.js` and, if user-visible, an
  example under `examples/` with a Leia README.

## YAML dependency

Keep `js-yaml` on major version 3 until the configuration loader is ported. The
`!archive` and `!include` custom types use the v3 `yaml.Type`, `Schema.create`
and `safeLoad` APIs; version 4 changes all three.
