---
title: Manually importing databases
description: Learn how to manually import other databases into your Lando Upsun Fixed site.
guide: true
mailchimp:
  action: https://dev.us12.list-manage.com/subscribe/post?u=59874b4d6910fa65e724a4648&amp;id=613837077f
  title: Want more Upsun Fixed guide content?
  byline: Signup and we will send you a weekly blog digest of similar content to keep you satiated.
  button: Sign me up!
---

If you have data that exists outside Platform.sh eg a `dump.sql` file you'd like to import you can leverage the special `lando` commands we give you to access each `relationship`. You will need to make sure that the relationship you connect with has the appropriate permissions needed to import your dump file.

```bash
# Import to the main schema using the database relationships
lando database main < dump.sql
```
