---
title: Manually importing databases
description: Import a SQL dump into a relationship's database.
---

# Manually importing databases

`lando pull` is the usual way to get data. To import a dump you already have,
use the relationship shell generated for it:

```bash
# MariaDB / MySQL relationship named "database"
lando database < dump.sql

# PostgreSQL relationship named "database"
lando database < dump.sql

# gzipped
gunzip -c dump.sql.gz | lando database
```

The shell connects as the local credentials Lando reports in
`DATABASE_USERNAME` / `DATABASE_PASSWORD` to the `DATABASE_PATH` database.
