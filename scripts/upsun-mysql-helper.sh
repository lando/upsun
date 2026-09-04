#!/usr/bin/env bash
set -e
exec 2>&1

ls -lsa /etc/apparmor.d || true
cat /etc/apparmor.d/usr.sbin.mysqld

if [ ! -f /mnt/data/.mysql-ready ]; then
    echo "database install"
    chpst -u app:app mysql_install_db \
          --defaults-file=/etc/platform/templates/my.cnf \
          --datadir=/mnt/data/mysql \
          --force \
          --skip-name-resolve
     touch /mnt/data/.mysql-ready
else
    # In case of UID instability, and to provide an upgrade path to the app user
    chown -R app:app /mnt/data/mysql
fi

echo "mysqld launch"
exec chpst -u app:app /usr/sbin/mysqld \
    --defaults-file=/etc/platform/templates/my.cnf \
    --basedir=/usr \
    --datadir=/mnt/data/mysql \
    --plugin-dir=/usr/lib/mysql/plugin \
    --pid-file=/run/mysqld/mysqld.pid \
    --socket=/run/mysqld/mysqld.sock
