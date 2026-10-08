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
npm test            # lint + typecheck + unit tests
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

`dev/` holds host-only maintainer scripts and is excluded from the npm package.
`scripts/` holds namespaced container helpers mounted at `/helpers/`.

Run `npm run typecheck` for JavaScript type checks over `jsconfig.json`. It fails on repository and configuration errors, excluding diagnostics from dependency files under `node_modules`. `npm run typecheck:full` includes dependency diagnostics and preserves the compiler's exit status.
Keep shared type definitions in co-located `.types.js` files and reference them with JSDoc `import()` types.
Typecheck runs in `npm test` and in the cross-platform unit-test CI job.

## Adding or updating a service mapping

- Bundled Lando plugins: edit `lib/mapping/services.js` and refresh the version
  tables with `node dev/update-versions.js`. The generator reads installed
  plugins from `LANDO_PLUGINS_DIR`, defaulting to `~/.lando/plugins/@lando`.
- Other images: add an entry to the `COMPOSE` table in the same file.
- Refresh Upsun lifecycle metadata and verified Docker Hub pins with
  `node dev/update-upsun-registry.js`. This dev-only generator writes
  `lib/mapping/upsun-registry.js`; keep the generated data with your changes.
  `UPSUN_META_REF` selects the upsun/meta ref (default `master`).
  `UPSUN_META_DIR` reads `resources/image/registry.json` from a local checkout;
  `UPSUN_REGISTRY_OUTPUT` overrides the output path. Docker Hub verification still
  uses the network. Output has no timestamps; unavailable pins are printed to stderr.
- Add a case to `test/mapping-services.spec.js` and, if user-visible, an
  example under `examples/` with a Leia README.

## YAML dependency

`js-yaml` is on major version 4. The `!archive` and `!include` custom types in
`lib/config/yaml.js` are built with `yaml.Type` and `DEFAULT_SCHEMA.extend`;
keep new tags on that API.
