# Upsun Flex Node.js example

This example verifies that a Flex project with a Node.js app started via
`web.commands.start` and a PostgreSQL relationship runs locally with the
`upsun` recipe.

## Start up tests

```bash
# Should start successfully
lando poweroff
lando start
```

## Verification commands

```bash
# Should use the requested runtime and service versions
lando node -v | grep "v22"
lando exec db -- psql --version | grep "16\."

# Should run the default build flavor (npm install) and then the build hook
lando exec api -- ls node_modules/pg/package.json
lando exec api -- cat build.log | grep "built v22"

# Should start the app with web.commands.start on PORT 8888
lando exec api -- env | grep "PORT=8888"
lando exec api -- curl -s http://localhost:8888/ | grep "app=api"
lando exec api -- curl -s http://localhost:8888/ | grep "greeting=hello"
lando exec api -- curl -s http://localhost:8888/ | grep "relationships=database"

# Should connect to PostgreSQL through the service environment variables
lando exec api -- curl -s http://localhost:8888/ | grep "db-ok"
lando exec api -- env | grep "DATABASE_URL=pgsql://postgres:@db:5432/main"

# Should create mounts
lando exec api -- ls -d /app/tmp-data

# Should provide node tooling, a psql shell and the upsun CLI
lando npm -v
lando database -c "select 1 as ok" | grep ok
lando upsun --version | grep "Upsun CLI"
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
