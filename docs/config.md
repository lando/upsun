---
title: Configuration
description: Learn how to configure the Lando Upsun Fixed recipe.
---

# Configuration

::: warning Fixed-only
Flex (`.upsun/config.yaml`) is a hard error. This page documents Fixed `.platform*` files only.
:::

While Lando [recipes](https://docs.lando.dev/core/v3/recipes.html) sets sane defaults so they work out of the box, they are also [configurable](https://docs.lando.dev/core/v3/recipes.html#config).

Here are the configuration options, set to the default values, for this recipe's [Landofile](https://docs.lando.dev/core/v3). If you are unsure about where this goes or what this means we *highly recommend* scanning the [recipes documentation](https://docs.lando.dev/core/v3/recipes.html) to get a good handle on how the magicks work.

```yaml
recipe: upsun
config:
  id: YOURSITEID
  overrides: {}
```

`recipe: platformsh` remains a deprecated alias for `recipe: upsun`. The Landofile stays small because Lando uses the same Fixed images and `.platform*` files as production.

This means that instead of modifying your Landofile to add, edit or remove the services, dependencies, build steps, etc you need to run your application you will want to modify your Platform.sh configuration according to their documentation and then do the usual `lando rebuild` for those changes to be applied.

Of course, since this is still a Lando recipe you can continue to [extend and override](https://docs.lando.dev/core/v3/recipes.html#extending-and-overriding-recipes) your Landofile in the usual way for any additional power you require locally.

Here are some details on how Lando interprets the various Platform.sh configuration files:

## routes.yaml

Lando will load your [routes.yaml](https://docs.platform.sh/define-routes.html) and use it for its own [proxy](https://docs.lando.dev/core/v3/proxy.html) configuration.

```yaml
# routes.yaml

"https://{default}/":
  type: upstream
  upstream: "app:http"
  cache:
    enabled: true
    # Base the cache on the session cookie and custom Drupal cookies. Ignore all other cookies.
    cookies: ['/^SS?ESS/', '/^Drupal.visitor/']

"https://www.{default}/":
  type: redirect
  to: "https://{default}/"
```

The above `routes` configuration example will produce the following Lando pretty proxy URLs, assuming `{default}` resolves to `my-app.lndo.site`.

```bash
http://my-app.lndo.site
https://my-app.lndo.site
http://www.my-app.lndo.site
https://www.my-app.lndo.site
```

Note, however, that Lando will **only** use routes that contain the `{default}` placeholder. FQDN routes will not be used since these generally will be pointing at your production site and not Lando. If you would still like to use these routes then we recommend you review our [proxy](https://docs.lando.dev/core/v3/proxy.html) docs on how to add them back into the mix.

## services.yaml

Lando will load your [services.yaml](https://docs.platform.sh/add-services.html) and spin up _exactly_ the same things there as you have running on your Platform.sh site, including any advanced configuration options you may have specified for each like `schemas`, `endpoints`, `extensions`, `properties`, etc.

This means that Lando knows how to handle more complex configuration such as in the below example:

```yaml
# services.yaml

db:
  type: mariadb:10.4
  disk: 2048
  configuration:
    schemas:
      - main
      - legacy
    endpoints:
      admin:
        default_schema: main
        privileges:
          main: admin
          legacy: admin
db2:
  type: postgresql:12
  disk: 1025
  configuration:
    extensions:
      - pg_trgm
      - hstore
```

We currently only support the below services and we _highly recommend_ you consult the Platform.sh docs for how to properly configure each.

* [Elasticsearch](https://docs.platform.sh/add-services/elasticsearch.html)
* [Headless Chrome](https://docs.platform.sh/add-services/headless-chrome.html)
* [InfluxDB](https://docs.platform.sh/add-services/influxdb.html)
* [Kafka](https://docs.platform.sh/add-services/kafka.html)
* [MariaDB/MySQL](https://docs.platform.sh/add-services/mysql.html)
* [Memcached](https://docs.platform.sh/add-services/memcached.html)
* [MongoDB](https://docs.platform.sh/add-services/mongodb.html)
* [PostgreSQL](https://docs.platform.sh/add-services/postgresql.html)
* [RabbitMQ](https://docs.platform.sh/add-services/rabbitmq.html)
* [Redis](https://docs.platform.sh/add-services/redis.html)
* [Solr](https://docs.platform.sh/add-services/solr.html)
* [Varnish](https://docs.platform.sh/add-services/varnish.html)

Also note that you will need to run a `lando rebuild` for configuration changes to manifest in the same way you normally would for config changes to your Landofile.

## .platform.app.yaml

Lando will load your [.platform.app.yaml](https://docs.platform.sh/create-apps.html) and spin up _exactly_ the same things there as you have running on your Platform.sh site. This means that similarly to Platform.sh Lando will also:

* Install any dependencies specificed in the `build.flavor` or `dependencies` keys
* Run any `build` or `deploy` hooks
* Set up needed `relationships`, `variables`, `web` config, `cron` tasks, etc.

We currently only support the below langauges and we _highly recommend_ you consult the Platform.sh docs for how to properly configure each.

* [PHP](https://docs.platform.sh/languages/php.html)

Also note that you will need to run a `lando rebuild` for configuration changes to manifest in the same way you normally would for config changes to your Landofile.

## Multiple applications

Lando _should_ support Platform.sh's [multiple applications configurations](https://docs.platform.sh/create-apps/multi-app.html) although they are not extensively tested at this point so YMMV.

If you have a multiple application setup then you will need to navigate into either the directory that contains the `.platform.app.yaml`  or the `source.root` specified in your `.platform/applications.yaml` file to access the relevant tooling for that app.

This is how tooling works for our [multiapp example](https://github.com/lando/platformsh/tree/main/examples/basics).

```bash
# Get access to tooling for the "base" application
lando

# Access tooling for the "discreet" application
cd discreet
lando

# Access tooling for the "php" application
cd ../php
lando
```

## Overriding config

Platform.sh application language and service configuration is generally optimized for production. While these values are usually also suitable for local development purposes Lando also provides a mechanism to override _both_ application language and service configuration with values that make more sense for local.

```yaml
name: myproject
recipe: upsun
config:
  id: PROJECTID
  overrides:
    app:
      variables:
        env:
          APP_ENV: dev
        d8settings:
          skip_permissions_hardening: 1
    db:
      configuration:
        properties:
          max_allowed_packet: 63
```

Note that `app` in the above example should correspond to the `name` of the Platform.sh application you want to override and `db` should correspond to the `name` of one of the services in your `services.yaml.` Also note that you will need to `lando rebuild` for this changes to apply.

## Environment variables

Application containers running on Lando will also set up the same [PLATFORM_* provided environment variables](https://docs.platform.sh/development/variables.html) so any service connection configuration, like connecting your Drupal site to `mysql` or `redis`, you use on Platform.sh with these variables _should_ also automatically work on Lando.

Lando _does not_ currently pull variables you have set up in the Platform.sh dashboard so you will need to add those manually.

Lando will also set and honor any [variables](https://docs.platform.sh/create-apps/app-reference.html#variables) that have been set up in your `.platform.app.yaml` or `applications.yaml`.

However, some of these, such as `APP_ENV=prod` do not make a ton of sense for local development. In these situations you can override _any_ Platform.sh variable directly from your Landofile with values that make more sense for local. Here is an example:

```yaml
name: platformsh-drupal8
recipe: upsun
config:
  id: PROJECTID
  overrides:
    app:
      variables:
        env:
          APP_ENV: dev
        d8settings:
          skip_permissions_hardening: 1
```

Perhaps more importantly, Lando **will not** automatically pull and set up environment variables that have been set in the [Platform Management Console](https://docs.platform.sh/administration/web/configure-environment.html#variables). This means that if your build hook requires these environment variables then it will likely fail.

To remediate we recommend you manually add these variables into a local [environment file](https://docs.lando.dev/core/v3/env.html#environment-files) that is also in your `.gitignore` and then `lando rebuild`. Here are some steps on how to do that.

1. Update your Landofile so it knows to load an environment file.

```yaml
env_file:
  - platformsh.local.env
```

2. **Make sure** you add it to your `.gitignore` file.

```
platformsh.local.env
```

3. Create the env file

```bash
touch platformsh.local.env
```

4. Discover envvars by running `lando platform var`
5. Use the information from above to populate `platformsh.local.env`

```bash
SPECIAL_KEY=mysecret
```

6. Run `lando rebuild` to trigger the build process using the newly added envvars.
