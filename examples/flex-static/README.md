# Upsun Flex static example

This example verifies that a static Flex app is served by an nginx sidecar
while its Node.js application container stays idle.

## Start up tests

```bash
# Should start successfully
lando poweroff
lando start
```

## Verification commands

```bash
# Should serve static locations from an nginx sidecar without a start command
curl -sk https://upsun-flex-static.lndo.site/ | grep "static-ok"
lando exec site -- curl -s http://site_nginx/ | grep "static-ok"
curl -sk -o /dev/null -w "%{http_code}" https://upsun-flex-static.lndo.site/private/secret.txt | grep 403
curl -skI https://upsun-flex-static.lndo.site/ | grep -i "expires"

# Should keep the app container idle
lando exec site -- pgrep -f "tail -f /dev/null"
lando exec site -- env | grep "PLATFORM_DOCUMENT_ROOT=/app/public"
```

## Destroy tests

```bash
# Should destroy successfully
lando destroy -y
lando poweroff
```
