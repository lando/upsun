Platform.sh Basics Example
==========================

This example exists primarily to test the core configuration options of the recipe

* [Recipe config](https://github.com/AaronFeledy/upsun/blob/main/docs/config.md)
* [Multiapp config](https://github.com/AaronFeledy/upsun/blob/main/docs/config.md#multiple-applications)
* [Overriding config](https://github.com/AaronFeledy/upsun/blob/main/docs/config.md#overriding-config)
* [Environment variables](https://github.com/AaronFeledy/upsun/blob/main/docs/config.md#environment-variables)

Start up tests
--------------

Run the following commands to get up and running with this example.

```bash
# Should poweroff
lando poweroff

# Should start up
lando start
```

Verification commands
---------------------

Run the following commands to validate things are rolling as they should.

```bash
# Should have the expected platformsh containers and images
docker ps --filter label=com.docker.compose.project=landoplatformshbasics | grep docker.registry.platform.sh/php-7.4 | grep landoplatformshbasics_base_1
docker ps --filter label=com.docker.compose.project=landoplatformshbasics | grep docker.registry.platform.sh/php-7.2 | grep landoplatformshbasics_discreet_1
docker ps --filter label=com.docker.compose.project=landoplatformshbasics | grep docker.registry.platform.sh/php-7.3 | grep landoplatformshbasics_php_1
docker ps --filter label=com.docker.compose.project=landoplatformshbasics | grep docker.registry.platform.sh/mariadb-10.2 | grep landoplatformshbasics_db_1

# Should use tooling based on the closest application
lando php -v | grep "PHP 7.4"
lando composer -v
lando database main -e "show tables"
cd discreet
lando php -v | grep "PHP 7.2"
lando composer -v
cd ../php
lando php -v | grep "PHP 7.3"
lando composer -v
lando maria main -e "show tables"

# Should configure the webroot for each application correctly
lando ssh -c "curl localhost" | grep base
cd discreet
lando ssh -c "curl localhost" | grep discreet
cd ../php
lando ssh -c "curl localhost" | grep "Sally Ride"

# Should be running all application containers as web
lando ssh -s base -c "id" | grep web
lando ssh -s discreet -c "id" | grep web
lando ssh -s php -c "id" | grep web

# Should set the correct default ssh service based on nearest application
lando ssh -c "env" | grep LANDO_SERVICE_NAME | grep base
cd discreet
lando ssh -c "env" | grep LANDO_SERVICE_NAME | grep discreet
cd ../php
lando ssh -c "env" | grep LANDO_SERVICE_NAME | grep php

# Should set the correct platform environment variables
lando ssh -c "env" | grep PLATFORM_APPLICATION
lando ssh -c "env" | grep PLATFORM_BRANCH
lando ssh -c "env" | grep PLATFORM_VARIABLES
lando ssh -c "env" | grep PLATFORM_ROUTES
lando ssh -c "env" | grep PLATFORM_RELATIONSHIPS
lando ssh -c "env" | grep PLATFORM_PROJECT_ENTROPY
lando ssh -c "env" | grep PLATFORM_APP_DIR | grep /app
lando ssh -c "env" | grep PLATFORM_APPLICATION_NAME | grep base
lando ssh -c "env" | grep PLATFORM_ENVIRONMENT | grep lando
lando ssh -c "env" | grep PLATFORM_TREE_ID | grep om2hlkobxcbwe-base
lando ssh -c "env" | grep PLATFORM_DIR | grep /app
lando ssh -c "env" | grep PLATFORM_PROJECT | grep om2hlkobxcbwe
lando ssh -c "env" | grep PLATFORM_APP_COMMAND | grep /usr/sbin/php-fpm
lando ssh -c "env" | grep PLATFORM_DOCUMENT_ROOT | grep /app/web
cd discreet
lando ssh -c "env" | grep PLATFORM_APPLICATION
lando ssh -c "env" | grep PLATFORM_BRANCH
lando ssh -c "env" | grep PLATFORM_VARIABLES
lando ssh -c "env" | grep PLATFORM_ROUTES
lando ssh -c "env" | grep PLATFORM_RELATIONSHIPS
lando ssh -c "env" | grep PLATFORM_PROJECT_ENTROPY
lando ssh -c "env" | grep PLATFORM_APP_DIR | grep /app
lando ssh -c "env" | grep PLATFORM_APPLICATION_NAME | grep discreet
lando ssh -c "env" | grep PLATFORM_ENVIRONMENT | grep lando
lando ssh -c "env" | grep PLATFORM_TREE_ID | grep om2hlkobxcbwe-discreet
lando ssh -c "env" | grep PLATFORM_DIR | grep /app
lando ssh -c "env" | grep PLATFORM_PROJECT | grep om2hlkobxcbwe
lando ssh -c "env" | grep PLATFORM_APP_COMMAND | grep /usr/sbin/php-fpm
lando ssh -c "env" | grep PLATFORM_DOCUMENT_ROOT | grep /app/web
cd ../php
lando ssh -c "env" | grep PLATFORM_APPLICATION
lando ssh -c "env" | grep PLATFORM_BRANCH
lando ssh -c "env" | grep PLATFORM_VARIABLES
lando ssh -c "env" | grep PLATFORM_ROUTES
lando ssh -c "env" | grep PLATFORM_RELATIONSHIPS
lando ssh -c "env" | grep PLATFORM_PROJECT_ENTROPY
lando ssh -c "env" | grep PLATFORM_APP_DIR | grep /app
lando ssh -c "env" | grep PLATFORM_APPLICATION_NAME | grep php
lando ssh -c "env" | grep PLATFORM_ENVIRONMENT | grep lando
lando ssh -c "env" | grep PLATFORM_TREE_ID | grep om2hlkobxcbwe-php
lando ssh -c "env" | grep PLATFORM_DIR | grep /app
lando ssh -c "env" | grep PLATFORM_PROJECT | grep om2hlkobxcbwe
lando ssh -c "env" | grep PLATFORM_APP_COMMAND | grep /usr/sbin/php-fpm
lando ssh -c "env" | grep PLATFORM_DOCUMENT_ROOT | grep /app/web

# Should have the platform cli in ALL application containers
lando ssh -s base -c "platform -V"
lando ssh -s discreet -c "platform -V"
lando ssh -s php -c "platform -V"

# Should load yamls from include tags correctly
cd discreet
lando ssh -c "env" | grep INCLUDED | grep "yes have some"

# Should be able to legacy override variables from landofile
cd php
lando ssh -c "env" | grep APP_ENV | grep lando

# Should be able to override application config from the landofile
cd discreet
lando ssh -c "env" | grep STUFF | grep "omg"

# Should be able to override service configuration from the landofile
lando database main -e "show variables;" | grep max_allowed_packet | grep 66060288

# Should be running the correct mariadb version
lando ssh -s db -c "mysql -V" | grep 10.2.

# Should be running mariadb with the correct user
lando ssh -s db -c "id" | grep app
```

Destroy tests
-------------

Run the following commands to trash this app like nothing ever happened.

```bash
# Should be able to destroy our site
lando destroy -y

# Should be able to poweroff
lando poweroff
```
