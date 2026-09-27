# Upsun Flex services example

This example connects one PHP 8.3 app to RabbitMQ 3.13, InfluxDB 2.7, Kafka 3.9.1,
OpenSearch 2, persistent Redis 7.2, Solr 9.9 and PostgreSQL 16. Solr exposes
`collection1`; PostgreSQL declares `main` and `reports`, with separate `admin`
and read-only `reporter` endpoints.

Run these commands from this directory. All requests stay inside the containers,
so the checks do not depend on the host's proxy ports.

The checks cover every relationship's host and a real service connection. The
PostgreSQL checks seed a report as the database owner, read it as `reporter`, and
require an attempted write to fail with a permission error.

Kafka's CLI runs as the image's `appuser`. The Landofile sets its working directory
to `/` because this service has no application mount at `/app`.

## Start up tests

```bash
# Should start successfully
lando start
```

## Verification commands

```bash
# Should run PHP 8.3 and display every relationship from the runtime payload
lando exec app -- php -v | grep "PHP 8.3"
lando exec app -- curl -sf http://app_nginx/ | grep "relationships=cache,database,influxdb,kafka,opensearch,rabbitmq,reports,solr"

# Should expose the RabbitMQ relationship host and answer its management health check
lando exec app -- env | grep '^RABBITMQ_HOST=rabbitmq$'
lando exec app -- sh -c 'curl -sf --retry 30 --retry-connrefused --retry-delay 1 --max-time 5 -u "$RABBITMQ_USERNAME:$RABBITMQ_PASSWORD" "http://$RABBITMQ_HOST:15672/api/health/checks/alarms"' | grep '"status":"ok"'

# Should expose the InfluxDB relationship host and pass its health check
lando exec app -- env | grep '^INFLUXDB_HOST=influxdb$'
lando exec app -- sh -c 'curl -sf --retry 30 --retry-connrefused --retry-delay 1 --max-time 5 "http://$INFLUXDB_HOST:$INFLUXDB_PORT/health"' | grep '"status":"pass"'

# Should expose the Kafka relationship host and connect from the app
lando exec app -- env | grep '^KAFKA_HOST=kafka$'
lando exec app -- php -r '$s = fsockopen(getenv("KAFKA_HOST"), (int) getenv("KAFKA_PORT"), $errno, $error, 5); if (!$s) {exit(1);} fclose($s); echo "kafka-connected\n";'

# Should create and list a Kafka topic through the broker CLI
lando exec kafka --user appuser -- /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic leia-services --partitions 1 --replication-factor 1
lando exec kafka --user appuser -- /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --list | grep '^leia-services$'

# Should expose the OpenSearch relationship host and return cluster information
lando exec app -- env | grep '^OPENSEARCH_HOST=opensearch$'
lando exec app -- sh -c 'curl -sf --retry 30 --retry-connrefused --retry-delay 1 --max-time 5 "http://$OPENSEARCH_HOST:$OPENSEARCH_PORT/"' | grep '"distribution" : "opensearch"'

# Should expose the persistent Redis relationship host and answer a network ping
lando exec app -- env | grep '^CACHE_HOST=cache$'
lando exec app -- php -r '$s = fsockopen(getenv("CACHE_HOST"), (int) getenv("CACHE_PORT"), $errno, $error, 5); if (!$s) {exit(1);} fwrite($s, "PING\r\n"); stream_set_timeout($s, 5); $reply = fgets($s); fclose($s); if ($reply !== "+PONG\r\n") {exit(1);} echo $reply;'

# Should expose the Solr relationship host and its configured core
lando exec app -- env | grep '^SOLR_HOST=solr$'
lando exec app -- sh -c 'curl -sf --retry 30 --retry-connrefused --retry-delay 1 --max-time 5 "http://$SOLR_HOST:$SOLR_PORT/solr/admin/cores?action=STATUS&wt=json"' | grep '"name":"collection1"'

# Should expose the admin relationship and allow writes to main from the app
lando exec app -- env | grep '^DATABASE_HOST=db$'
lando exec app -- sh -c 'PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USERNAME" -d "$DATABASE_PATH" -v ON_ERROR_STOP=1 -Atc "SELECT current_user, current_database(); BEGIN; CREATE TABLE leia_admin (id integer); INSERT INTO leia_admin VALUES (1); ROLLBACK;"'

# Should expose the reporter endpoint and read reports from the app
lando exec app -- env | grep '^REPORTS_HOST=db$'
lando exec app -- env | grep '^REPORTS_USERNAME=reporter$'
lando exec app -- env | grep '^REPORTS_PATH=reports$'
lando exec app -- sh -c 'PGPASSWORD="" psql -h "$REPORTS_HOST" -U postgres -d "$REPORTS_PATH" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS leia_report (id integer); INSERT INTO leia_report VALUES (1);"'
lando exec app -- sh -c 'PGPASSWORD="$REPORTS_PASSWORD" psql -h "$REPORTS_HOST" -p "$REPORTS_PORT" -U "$REPORTS_USERNAME" -d "$REPORTS_PATH" -v ON_ERROR_STOP=1 -Atc "SELECT current_user, current_database(), id FROM leia_report WHERE id = 1;"' | grep '^reporter|reports|1$'

# Should deny writes by the read-only reporter endpoint
lando exec app -- sh -c 'output=$(PGPASSWORD="$REPORTS_PASSWORD" psql -h "$REPORTS_HOST" -p "$REPORTS_PORT" -U "$REPORTS_USERNAME" -d "$REPORTS_PATH" -v ON_ERROR_STOP=1 -c "INSERT INTO leia_report VALUES (2);" 2>&1) && exit 1; printf "%s\n" "$output" | grep "permission denied for table leia_report"'
lando exec app -- sh -c 'PGPASSWORD="" psql -h "$REPORTS_HOST" -U postgres -d "$REPORTS_PATH" -v ON_ERROR_STOP=1 -c "DROP TABLE leia_report;"'
```

## Destroy tests

Destroying the app deletes its local service data.

```bash
# Should destroy successfully
lando destroy -y
```
