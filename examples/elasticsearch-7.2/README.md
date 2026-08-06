Platform.sh elasticsearch 7.2 Example
=================================

This example exists to test this plugin's implementation of Platform.sh's `elasticsearch:7.2` service.

* [`elasticsearch:7.2`](https://docs.platform.sh/configuration/services/elasticsearch.html)

Start up tests
--------------

Run the following commands to get up and running with this example.

```bash
# Should poweroff
lando poweroff

# Should start up successfully
lando start
```

Verification commands
---------------------

Run the following commands to validate things are rolling as they should.

```bash
# Should have the expected platformsh containers and images
docker ps --filter label=com.docker.compose.project=landoplatformshelasticsearch72 | grep docker.registry.platform.sh/php-7.3 | grep landoplatformshelasticsearch72_app_1
docker ps --filter label=com.docker.compose.project=landoplatformshelasticsearch72 | grep docker.registry.platform.sh/elasticsearch-7.2 | grep landoplatformshelasticsearch72_searchelastic_1

# Should be running all application containers as web
lando ssh -s app -c "id" | grep web

# Should have the platform cli in all application containers
lando ssh -s app -c "platform -V"

# Should be running the correct php version
lando ssh -s app -c "php --version" | grep 7.3.

# Should be running all elasticsearch containers as elasticsearch
lando ssh -s searchelastic -c "id" | grep elasticsearch

# Should be running the correct elasticsearch versions
lando ssh -s searchelastic -c "curl -XGET 'http://localhost:9200'" | grep 7.2

# Should be able to connect to elasticsearch from the application containers
lando ssh -s app -c "curl localhost/esearch.php" | grep "Barbara Liskov"

# Should be running the correct elasticsearch versions (plugin service)
lando ssh -s searchelastic-plugin -c "curl -XGET 'http://localhost:9200'" | grep 7.2

# Should be able to enable the _size field for mapper-size plugin
lando ssh -s searchelastic-plugin -c "curl -X PUT 'localhost:9200/my_index?pretty' -H 'Content-Type:application/json' -d'{\"mappings\": {\"_doc\": {\"_size\": {\"enabled\": true}}}}'"

# Should be able to add a doc to the ES index
lando ssh -s searchelastic-plugin -c "curl -X PUT 'localhost:9200/my-index/_doc/1?pretty' -H 'Content-Type: application/json' -d'{\"text\": \"This is a document\"}'"

# Should see _size field when querying ES index.
lando ssh -s searchelastic-plugin -c "curl -X GET 'localhost:9200/my_index/_search?pretty' -H 'Content-Type: application/json' -d '{  \"query\": {    \"range\": {      \"_size\": {         \"gt\": 10      }    }  },  \"aggs\": {    \"sizes\": {      \"terms\": {        \"field\": \"_size\",         \"size\": 10      }    }  },  \"sort\": [    {      \"_size\": {         \"order\": \"desc\"      }    }  ],  \"script_fields\": {    \"size\": {      \"script\": \"doc[\\u0027_size\\u0027]\"      }  }}'" | grep sizes

```

Destroy tests
-------------

Run the following commands to trash this app like nothing ever happened.

```bash
# Should be able to destroy our app
lando destroy -y

# Should poweroff
lando poweroff
```
