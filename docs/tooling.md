---
description: Learn about the various out-of-the-box tooling you get with the Lando Platform.sh recipe.
---

# Tooling

## Platform.sh CLI (Fixed)

Every application container still contains the [Platform.sh CLI](https://docs.platform.sh/administration/cli.html) (`platform`), authenticated with `PLATFORMSH_CLI_TOKEN`. This phase does **not** switch Fixed ops to the `upsun` binary.

```bash
# Who am i?
lando platform auth:info

# Tell me about my project
lando platform project:info
```

If you find yourself unauthenticated for whatever reason. You should try the following:

```bash
# Reauthenticate using already pulled down code
lando init --source cwd --recipe upsun

# Rebuild your lando app
lando rebuild -y
```

## Application Tooling

Lando will also setup useful [tooling commands](https://docs.lando.dev/core/v3/tooling.html) based on the `type` of your application container.

These can be used to both relevant tooling and utilities that exist _inside_ the application container. Here are the defaults we provide for the `php` application container.

```bash
lando composer    Runs composer commands
lando php         Runs php commands
```

#### Usage

```bash
# Install some composer things
lando composer require drush/drush

# Run a php script
lando php myscript.php
```

Of course the user can also `lando ssh` and work directly inside _any_ of the containers Lando spins up for your app.

```bash
# Attach to the closest applicaiton container
lando ssh

# Attach to the db service
lando ssh -s db
```

Note that Lando will surface commands for the _closest application_ it finds. Generally, this will be the `.platform.app.yaml` located in your project root but if you've `cd multiappsubdir` then it will use that instead.

## Accessing relationships

Lando will also set up tooling commands so you can directly access the `relationships` specified in your `.platform.app.yaml`.

These are contextual so they will connect via the tool that makes the most sense eg `mysql` for `mariadb` and `redis-cli` for `redis`.

As an example say you have the following relationships in your `.platform.app.yaml`.

```yaml
relationships:
  database: 'db:mysql'
  redis: 'cache:redis'
```

Then you'd expect to see the following commands and usage:

```bash
lando database  Connects to the database relationship
lando redis     Connects to the database relationship
```

```bash
# Drop into the mysql shell using the database relationship creds
lando database

# Drop into the redis-cli shell using the redis relationship creds
lando redis
```

Note that some services eg `solr` provide `web` based interfaces. In these cases Lando will provide a `localhost` address you can use to access that interface.
