# Upsun Flex PHP example

This example verifies that a Flex project (`.upsun/config.yaml`) with a PHP app,
MariaDB and Redis runs locally with the `upsun` recipe.

## Start up tests

```bash
# Should start successfully
lando poweroff
lando start
```

## Verification commands

```bash
# Should use Lando-native service images for the Upsun types
lando exec app -- php -v | grep "PHP 8.3"
lando exec db -- mariadb --version | grep "11.4"
lando exec redis -- redis-server --version | grep "v=7.2"

# Should inject the Upsun runtime contract into the app container
lando exec app -- env | grep "PLATFORM_APPLICATION_NAME=app"
lando exec app -- env | grep "PLATFORM_VENDOR=upsun"
lando exec app -- env | grep "PLATFORM_DOCUMENT_ROOT=/app/web"
lando exec app -- env | grep "PLATFORM_RELATIONSHIPS="
lando exec app -- env | grep "PLATFORM_ROUTES="
lando exec app -- env | grep "FOO=bar"

# Should expose per-relationship service environment variables
lando exec app -- env | grep "DATABASE_HOST=db"
lando exec app -- env | grep "DATABASE_URL=mysql://upsun:upsun@db:3306/main"
lando exec app -- env | grep "REDIS_URL=redis://redis:6379"

# Should serve the app through nginx and connect to its relationships
lando exec app -- curl -s http://app_nginx/ | grep "app=app"
lando exec app -- curl -s http://app_nginx/ | grep "relationships=database,redis"
lando exec app -- curl -s http://app_nginx/ | grep "db-ok"
lando exec app -- curl -s http://app_nginx/ | grep "redis-ok"

# Should run the build and deploy hooks
lando exec app -- curl -s http://app_nginx/ | grep "hook=build-hook"
lando exec app -- curl -s http://app_nginx/ | grep "deploy=deploy-hook"

# Should create mounts
lando exec app -- ls -d /app/web/files

# Should install the upsun CLI and database clients
lando upsun --version | grep "Upsun CLI"
lando exec app -- which mysql
lando exec app -- which psql

# Should provide relationship shells and language tooling
lando database -e "select 1 as ok" | grep ok
lando redis ping | grep PONG
lando php -v | grep "PHP 8.3"

# Should run crons on demand
lando cron hello | grep cron-ran
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
