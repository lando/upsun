<?php
header('Content-Type: text/plain');
echo 'app=' . getenv('PLATFORM_APPLICATION_NAME') . "\n";
echo 'vendor=' . getenv('PLATFORM_VENDOR') . "\n";
echo 'foo=' . getenv('FOO') . "\n";
$relationships = json_decode(base64_decode(getenv('PLATFORM_RELATIONSHIPS')), true);
echo 'relationships=' . implode(',', array_keys($relationships)) . "\n";
try {
  $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', getenv('DATABASE_HOST'), getenv('DATABASE_PORT'), getenv('DATABASE_PATH'));
  $pdo = new PDO($dsn, getenv('DATABASE_USERNAME'), getenv('DATABASE_PASSWORD'));
  $pdo->query('SELECT 1');
  echo "db-ok\n";
} catch (Throwable $e) {
  echo 'db-fail: ' . $e->getMessage() . "\n";
}
$socket = @fsockopen(getenv('CACHE_HOST'), (int) getenv('CACHE_PORT'), $errno, $errstr, 2);
if ($socket) {
  fwrite($socket, "version\r\n");
  echo str_starts_with(fgets($socket), 'VERSION') ? "memcached-ok\n" : "memcached-fail\n";
  fclose($socket);
} else {
  echo "memcached-fail: $errstr\n";
}
echo 'hook=' . trim(@file_get_contents(__DIR__ . '/hook.txt')) . "\n";
