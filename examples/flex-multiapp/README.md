# Upsun Flex multi-app example

This example verifies two Flex applications, a worker, shared MariaDB schemas,
endpoint privileges, redirects and closest-app tooling with the `upsun` recipe.

## Start up tests

```bash
# Should start successfully
lando poweroff
lando start
```

## Verification commands

```bash
# Should create both apps, the worker and the shared database
lando exec app -- php -v | grep "PHP 8.3"
lando exec api -- node -v | grep "v22"
lando exec app--queue -- pgrep -f "php worker.php"
lando exec db -- mariadb --version | grep "11.4"

# Should route each app on its own host under the Lando app name
curl -sk https://upsun-flex-multiapp.lndo.site/ | grep "app=app"
curl -sk https://api.upsun-flex-multiapp.lndo.site/ | grep "app=api"
curl -sk https://api.upsun-flex-multiapp.lndo.site/ | grep "db-ok"
lando exec app -- curl -s http://app_nginx/ | grep "app=app"
lando exec api -- curl -s http://localhost:8888/ | grep "app=api"
lando exec api -- curl -s http://localhost:8888/ | grep "db-ok"

# Should issue real redirects for redirect routes and redirects.paths
curl -s -o /dev/null -w "%{http_code}" http://www.upsun-flex-multiapp.lndo.site/ | grep 301
curl -sI http://www.upsun-flex-multiapp.lndo.site/ | grep -i "location: https://upsun-flex-multiapp.lndo.site"
curl -sI http://upsun-flex-multiapp.lndo.site/old | grep -i "location: https://upsun-flex-multiapp.lndo.site/new"

# Should create every schema and endpoint user with the configured privileges
lando exec app -- curl -s http://app_nginx/ | grep "relationships=database,reports"
lando exec app -- curl -s http://app_nginx/ | grep "admin-ok"
lando exec app -- curl -s http://app_nginx/ | grep "reporter-read-ok"
lando exec app -- curl -s http://app_nginx/ | grep "reporter-ro"
lando exec app -- env | grep "REPORTS_URL=mysql://reporter:upsun@db:3306/legacy"

# Should apply timezone, variables.php and additional_hosts
lando exec app -- curl -s http://app_nginx/ | grep "tz=Europe/Paris"
lando exec app -- curl -s http://app_nginx/ | grep "memory_limit=256M"
lando exec app -- curl -s http://app_nginx/ | grep "session=files"
lando exec app -- curl -s http://app_nginx/ | grep "host=127.0.0.1"

# Should run the worker with the app environment and no build steps
lando exec app -- curl -s http://app_nginx/ | grep "worker=worker-alive"
lando exec app--queue -- env | grep "PLATFORM_APP_COMMAND=php worker.php"
lando exec app--queue -- env | grep "PLATFORM_APPLICATION_NAME=app"

# Should expose runtime operations and target the closest app for tooling
lando operation hello | grep operation-ran
lando php -r 'echo getenv("PLATFORM_APPLICATION_NAME");' | grep app
lando reports -e "select 1 as ok" | grep ok
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
