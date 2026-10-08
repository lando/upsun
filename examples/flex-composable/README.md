# Upsun Flex composable example

This example verifies that a composable Flex app runs its first runtime,
configures PHP extensions and installs a secondary Node.js runtime.

## Start up tests

```bash
# Should start successfully
lando poweroff
lando start
```

## Verification commands

```bash
# Should run the first composable runtime as the primary service
lando exec app -- php -v | grep "PHP 8.4"
lando exec app -- curl -s http://app_nginx/ | grep "php=8.4"

# Should enable and disable the composable PHP extensions
lando exec app -- curl -s http://app_nginx/ | grep "xsl=yes"
lando exec app -- curl -s http://app_nginx/ | grep "redis=yes"
lando exec app -- curl -s http://app_nginx/ | grep "imap=no"

# Should install the secondary Node.js runtime into the PHP container
lando exec app -- node -v | grep "v22"
lando exec app -- curl -s http://app_nginx/ | grep "node=v22"

# Should not warn about ignored runtimes
lando info > /tmp/flex-composable-info.log 2>&1 && ! grep "composable-runtime-picked" /tmp/flex-composable-info.log
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
