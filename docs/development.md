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

Run `npm run typecheck` for non-gated JSDoc checks; `npm run typecheck:full` also shows dependency errors.
Keep shared type definitions in co-located `.types.js` files and reference them with JSDoc `import()` types.
Typecheck is advisory while existing code is being annotated; lint and unit tests remain the required checks.

## Adding or updating a service mapping

- Bundled Lando plugins: edit `lib/mapping/services.js` and refresh the version
  tables with `node scripts/update-versions.js`. The generator reads installed
  plugins from `LANDO_PLUGINS_DIR`, defaulting to `~/.lando/plugins/@lando`.
- Other images: add an entry to the `COMPOSE` table in the same file.
- Add a case to `test/mapping-services.spec.js` and, if user-visible, an
  example under `examples/` with a Leia README.

## YAML dependency

`js-yaml` is on major version 4. The `!archive` and `!include` custom types in
`lib/config/yaml.js` are built with `yaml.Type` and `DEFAULT_SCHEMA.extend`;
keep new tags on that API.
