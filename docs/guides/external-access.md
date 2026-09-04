---
title: Externally accessing services
description: Learn how to externally access your Upsun Fixed services when running in Lando.
guide: true
mailchimp:
  action: https://dev.us12.list-manage.com/subscribe/post?u=59874b4d6910fa65e724a4648&amp;id=613837077f
  title: Want more Upsun Fixed guide content?
  byline: Signup and we will send you a weekly blog digest of similar content to keep you satiated.
  button: Sign me up!
---

If you would instead like to connect to your database, or some other service, from your host using a GUI client like SequelPro, instead of via the Lando CLI you can run [`lando info`](https://docs.lando.dev/cli/info.html) and use the `external_connection` information and any relevant `creds` for the service you want to connect to.

Here is example connection info for a multi-endpoint `mariadb` service called `db` below:

```bash
lando info --service db --format default

  { service: 'db',
    urls: [],
    type: 'platformsh-mariadb',
    healthy: true,
    creds:
     [ { internal_hostname: 'database2.internal',
         password: '3ac01938c66f0ce06304a6357da17c34',
         path: 'main',
         port: 3306,
         user: 'admin' },
       { internal_hostname: 'reports.internal',
         password: 'd0c99f580a0d646d62904568573f5012',
         port: 3306,
         user: 'reporter' },
       { internal_hostname: 'imports.internal',
         password: 'a6bf5826a81f7e9a3fa42baa790207ef',
         path: 'legacy',
         port: 3306,
         user: 'importer' } ],
    internal_connection: { host: 'db', port: '3306' },
    external_connection: { host: '127.0.0.1', port: '32915' },
    config: {},
    version: '10.4',
    meUser: 'app',
    hasCerts: false,
    hostnames: [ 'db.landod8.internal' ] },
```

Note that you _must_ have a relationship from your app to a given service in order for it to have credentials.

Also note that this is slightly different than the normal output from `lando info` because `platformsh` services work slightly different. While you _can_ use the `internal_connection:host` and `internal_connection:port` for internal connections we recommend you use the `host` and `port` indicated for the relevant `cred` you want to connect to instead.

So if you wanted to connect to the `main` db you would use the following depending on whether you are connecting externally or internally:

**external creds**

```yaml
host: 127.0.0.1
port: 32915
user: admin
password: 3ac01938c66f0ce06304a6357da17c34
database: main
```

**internal creds**

```yaml
host: database2.internal
port: 3306
user: admin
password: 3ac01938c66f0ce06304a6357da17c34
database: main
```

Of course, it is always preferrable to just use `PLATFORM_RELATIONSHIPS` for all your internal connections anyway.

