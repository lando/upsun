# Upsun Fixed PHP example

This example verifies that an Upsun Fixed project (`.platform.app.yaml` +
`.platform/`) with a PHP app, PostgreSQL and Memcached runs locally with the
`upsun` recipe and uses the `platform` CLI.

## Start up tests

```bash
# Should start successfully
lando poweroff
lando start
```

## Verification commands

```bash
# Should use Lando-native service images for the Platform.sh types
lando exec app -- php -v | grep "PHP 8.2"
lando exec db -- psql --version | grep "15\."
lando exec memcache -- memcached --version | grep "1.6"

# Should identify the project as Upsun Fixed
lando exec app -- env | grep "PLATFORM_VENDOR=platformsh"
lando exec app -- env | grep "PLATFORM_APPLICATION_NAME=app"
lando exec app -- env | grep "FOO=fixed"

# Should expose per-relationship service environment variables
lando exec app -- env | grep "DATABASE_URL=pgsql://postgres:@db:5432/main"
lando exec app -- env | grep "CACHE_URL=memcached://memcache:11211"

# Should serve the app and connect to its relationships
lando exec app -- curl -s http://app_nginx/ | grep "relationships=cache,database"
lando exec app -- curl -s http://app_nginx/ | grep "db-ok"
lando exec app -- curl -s http://app_nginx/ | grep "memcached-ok"
lando exec app -- curl -s http://app_nginx/ | grep "hook=build-hook"

# Should create local mounts
lando exec app -- ls -d /app/web/files

# Should install the platform CLI for Fixed projects
lando platform --version | grep "5\."
lando exec app -- which psql

# Should provide a psql relationship shell
lando database -c "select 1 as ok" | grep ok
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
