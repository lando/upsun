---
title: Adding more tooling commands
description: Add tooling commands to your Lando Upsun project.
guide: true
---

While Lando will set up tooling routes for the _obvious_ utilities for each application `type` it tries to not overwhelm the user with _all the commands_ by providing a minimally useful set. It does this because it is very easy to specify more tooling commands in your Landofile.

```yaml
tooling:
  # Here are some utilities that should exist in every application
  # container
  node:
    service: app
  npm:
    service: app
  ruby:
    service: app

  # And some utilities we installed in the `build.flavor`
  # or `dependencies` key
  grunt:
    service: app
  sass:
    service: app
  drush:
    service: app

```

Note that the `service` should match the name of your application in `.upsun/config.yaml` (or `.platform.app.yaml`). Very often this is just `app`.

Now run `lando` again and see that extra commands!

```bash
lando composer      Runs composer commands
lando drush         Runs drush commands
lando grunt         Runs grunt commands
lando node          Runs node commands
lando npm           Runs npm commands
lando php           Runs php commands
lando ruby          Runs ruby commands
lando sass          Runs sass commands
```

```bash
lando drush cr
lando npm install
lando grunt compile:things
lando ruby -v
lando node myscript.js
```

If you are not sure whether something exists inside your application container or not you can easily test using the `-c` option provided by l`lando ssh`

```bash
# Does yarn exist?
lando ssh -c "yarn"
```

Also note that Lando tooling is hyper-powerful so you might want to [check out](https://docs.lando.dev/core/v3/tooling.html) some of its more advanced features.
