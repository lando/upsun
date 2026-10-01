<?php
header('Content-Type: text/plain');
echo 'app=' . getenv('MAGENTO_CLOUD_APPLICATION_NAME') . "\n";
$relationships = json_decode(base64_decode(getenv('MAGENTO_CLOUD_RELATIONSHIPS')), true);
$names = array_keys($relationships);
sort($names);
echo 'relationships=' . implode(',', $names) . "\n";
