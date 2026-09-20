---
title: Externally accessing services
description: Connect to your Upsun services from tools on your host.
guide: true
---

Database and cache services are started with `portforward: true`, so Lando
publishes them on a random localhost port. Run `lando info` to find it:

```bash
lando info --service db
```

```js
{
  service: 'db',
  type: 'mariadb',
  creds: { user: 'upsun', password: 'upsun', database: 'main' },
  external_connection: { host: '127.0.0.1', port: '63067' },
  ...
}
```

Use `external_connection` plus `creds` in your database client. To pin the
port, override the service:

```yaml
config:
  overrides:
    db:
      portforward: 3307
```
