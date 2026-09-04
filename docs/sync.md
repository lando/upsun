---
description: Learn how to sync databases, files, relationships and mounts between local Lando and a remote Fixed environment.
---

# Syncing

Lando also provides wrapper commands called `lando pull` and `lando push`.

With `lando pull` you can import data and download files from your remote Platform.sh site. With `lando push` you can do the opposite, export data or upload files to your remote Platform.sh site.

Note that only database relationships are currently syncable.

## Pulling

```bash
lando pull

Pull relationships and/or mounts from Platform.sh

Options:
  --help              Shows lando or delegated command help if applicable
  --verbose, -v       Runs with extra verbosity
  --auth              Platform.sh API token
  --mount, -m         A mount to download
  --relationship, -r  A relationship to import
```

```bash
# Interactively pull relationships and mounts
lando pull

# Import the remote database relationship and drupal files mount
lando pull -r database -m web/sites/default/files

# Import multiple relationships and mounts
lando pull -r database -r migrate -r readonly -m tmp -m private

# You can also specify a target for a given mount using -m SOURCE:TARGET
lando pull -m tmp:/var/www/tmp -m /private:/somewhere/else

# You can also specify a target db/schema for a given relationships using -r RELATIONSHIP:SCHEMA
lando pull -r admin:legacy

# Skip the mounts part
lando pull -r database -m none

# Effectively "do nothing"
lando pull -r none -m none
```

## Pushing

```bash
lando push

Push relationships and/or mounts to Platform.sh

Options:
  --help              Shows lando or delegated command help if applicable
  --verbose, -v       Runs with extra verbosity
  --auth              Platform.sh API token
  --mount, -m         A mount to push up
  --relationship, -r  A relationship to push up
```

```bash
# Interactively push relationships and mounts
lando push

# Import the remote database relationship and drupal files mount
lando push -r database -m web/sites/default/files

# Import multiple relationships and mounts
lando push -r database -r migrate -r readonly -m tmp -m private

# You can also specify a target for a given mount using -m SOURCE:TARGET
lando push -m tmp:/var/www/tmp -m /private:/somewhere/else

# You can also specify a target db/schema for a given relationships using -r RELATIONSHIP:SCHEMA
lando push -r admin:legacy -r admin:main

# Skip the relationships part
lando push -r none -m tmp

# Effectively "do nothing"
lando push -r none -m none
```
