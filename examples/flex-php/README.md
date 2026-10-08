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

# Should derive the project id from .upsun/local/project.yaml
lando exec app -- env | grep "PLATFORM_PROJECT=localprojectid"

# Should inject the Upsun runtime contract into the app container
lando exec app -- env | grep "PLATFORM_APPLICATION_NAME=app"
lando exec app -- env | grep "PLATFORM_VENDOR=upsun"
lando exec app -- env | grep "PLATFORM_DOCUMENT_ROOT=/app/web"
lando exec app -- env | grep "PLATFORM_SMTP_HOST=mailpit"
lando exec app -- env | grep "PLATFORM_PRE_APP_COMMAND=echo pre-start"
lando exec app -- env | grep "FOO=bar"

# Should expose per-relationship service environment variables
lando exec app -- env | grep "DATABASE_URL=mysql://upsun:upsun@db:3306/main"
lando exec app -- env | grep "REDIS_URL=redis://redis:6379"

# Should serve the app on the Lando app name and connect to its relationships
curl -sk https://upsun-flex-php.lndo.site/ | grep "app=app"
lando exec app -- curl -s http://app_nginx/ | grep "relationships=database,redis"
lando exec app -- curl -s http://app_nginx/ | grep "db-ok"
lando exec app -- curl -s http://app_nginx/ | grep "redis-ok"

# Should redirect www to the default route with a 301
curl -s -o /dev/null -w "%{http_code}" http://www.upsun-flex-php.lndo.site/ | grep 301
curl -sI http://www.upsun-flex-php.lndo.site/ | grep -i "location: https://upsun-flex-php.lndo.site"

# Should run build, deploy and pre_start hooks
lando exec app -- curl -s http://app_nginx/ | grep "hook=build-hook"
lando exec app -- curl -s http://app_nginx/ | grep "deploy=deploy-hook"
lando exec app -- curl -s http://app_nginx/ | grep "pre=pre-start"

# Should apply variables.php and install runtime extensions
lando exec app -- curl -s http://app_nginx/ | grep "memory_limit=384M"
lando exec app -- curl -s http://app_nginx/ | grep "xsl=yes"

# Should create mounts and the database user every start
lando exec app -- ls -d /app/web/files
lando exec app -- mysql -h db -u root --skip-password -e "select user from mysql.user" | grep upsun

# Should install the upsun CLI and jq
lando upsun --version | grep "Upsun CLI"
lando exec app -- which jq

# Should provide relationship shells and language tooling
lando database -e "select 1 as ok" | grep ok
lando redis ping | grep PONG
lando php -v | grep "PHP 8.3"

# Should export and import the main database
lando exec db -- env | grep '^MYSQL_DATABASE=main$'
lando db-export dump.sql | grep 'Success .*dump.sql.gz was created!'
lando db-import dump.sql.gz | grep 'Import complete!'

# Should run crons on demand and schedule them in the cron sidecar
lando cron hello | grep cron-ran
lando exec app--cron -- cat /tmp/crontab | grep "upsun-cron.sh tick"
lando exec app--cron -- pgrep -f supercronic

# Should deliver mail to mailpit
lando exec app -- php -r 'mail("to@example.com", "leia-subject", "hello");'
sleep 3
curl -s http://mail.upsun-flex-php.lndo.site/api/v1/messages | grep leia-subject

# Should toggle xdebug for web requests
lando xdebug-on
lando exec app -- curl -s http://app_nginx/ | grep "xdebug=debug"
lando xdebug-off
lando exec app -- curl -s http://app_nginx/ | grep "xdebug=off"
```

## Destroy tests

```bash
rm -f dump.sql dump.sql.gz
# Should destroy successfully
lando destroy -y
lando poweroff
```
