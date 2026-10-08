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
lando exec api -- env | grep "DATABASE_URL=pgsql://upsun:upsun@db:5432/main"

# Should serve the app on the Lando app name through the proxy
curl -sk https://upsun-flex-node.lndo.site/ | grep "app=api"

# Should run pre_start before and post_start after the start command
lando exec api -- curl -s http://localhost:8888/ | grep "pre=pre-start"
lando exec api -- curl -s http://localhost:8888/ | grep "post=post-start"

# Should install database clients, rsync, ssh and jq for sync and hooks
lando exec api -- which mysql
lando exec api -- which psql
lando exec api -- which rsync
lando exec api -- which ssh
lando exec api -- which jq

# Should create the PostgreSQL role with a password every start
lando exec api -- env | grep "DATABASE_PASSWORD=upsun"
lando database -c "select current_user" | grep upsun

# Should create mounts
lando exec api -- ls -d /app/tmp-data

# Should provide node tooling, a psql shell and the upsun CLI
lando npm -v
lando database -c "select 1 as ok" | grep ok
lando upsun --version | grep "Upsun CLI"

# Should export and import the main database
lando exec db -- env | grep '^POSTGRES_DB=main$'
lando db-export dump.sql | grep 'Success .*dump.sql.gz was created!'
lando db-import dump.sql.gz | grep 'Import complete!'
rm -f dump.sql dump.sql.gz
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
