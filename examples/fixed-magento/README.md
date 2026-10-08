# Adobe Commerce Cloud local example

Run a `.magento.app.yaml` project locally with PHP, MariaDB and Redis.
The recipe mirrors `PLATFORM_*` variables as `MAGENTO_CLOUD_*`. Remote pull,
push and switch operations aren't supported; use the `magento-cloud` CLI.

## Start up tests

```bash
# Should start successfully
lando poweroff
lando start
```

## Verification commands

```bash
# Should expose the Adobe Commerce Cloud environment
lando exec mymagento -- env | grep '^MAGENTO_CLOUD_APPLICATION_NAME=mymagento$'
lando exec mymagento -- sh -c '[ "$MAGENTO_CLOUD_RELATIONSHIPS" = "$PLATFORM_RELATIONSHIPS" ]'

# Should serve the app with both relationship names
lando exec mymagento -- curl -fsS http://mymagento_nginx/ | grep 'app=mymagento'
lando exec mymagento -- curl -fsS http://mymagento_nginx/ | grep 'relationships=database,redis'

# Should explain why remote operations are unavailable
output=$(lando pull 2>&1) && exit 1; printf '%s\n' "$output" | grep 'not available for Adobe Commerce'
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
