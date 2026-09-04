---
title: Adding more tooling commands
description: Learn how to add additional tooling commands to your Lando Upsun Fixed site.
guide: true
mailchimp:
  action: https://dev.us12.list-manage.com/subscribe/post?u=59874b4d6910fa65e724a4648&amp;id=613837077f
  title: Want more Upsun Fixed guide content?
  byline: Signup and we will send you a weekly blog digest of similar content to keep you satiated.
  button: Sign me up!
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

Note that the `service` should match the `name` of your application in the associated `.platform.app.yaml`. Very often this is just `app`.

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
