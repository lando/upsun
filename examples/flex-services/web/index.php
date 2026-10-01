<?php

header('Content-Type: text/plain');
$relationships = json_decode(base64_decode(getenv('PLATFORM_RELATIONSHIPS')), true, 512, JSON_THROW_ON_ERROR);
$names = array_keys($relationships);
sort($names);
echo 'relationships=' . implode(',', $names) . PHP_EOL;
