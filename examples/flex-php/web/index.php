<?php
header('Content-Type: text/plain');
echo 'app=' . getenv('PLATFORM_APPLICATION_NAME') . "\n";
echo 'vendor=' . getenv('PLATFORM_VENDOR') . "\n";
echo 'foo=' . getenv('FOO') . "\n";
echo 'pre=' . trim(@file_get_contents(__DIR__ . '/pre.txt')) . "\n";
echo 'memory_limit=' . ini_get('memory_limit') . "\n";
echo 'xsl=' . (extension_loaded('xsl') ? 'yes' : 'no') . "\n";
echo 'xdebug=' . (extension_loaded('xdebug') ? ini_get('xdebug.mode') : 'off') . "\n";
echo 'smtp=' . getenv('PLATFORM_SMTP_HOST') . "\n";

$relationships = json_decode(base64_decode(getenv('PLATFORM_RELATIONSHIPS')), true);
echo 'relationships=' . implode(',', array_keys($relationships)) . "\n";

try {
  $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s', getenv('DATABASE_HOST'), getenv('DATABASE_PORT'), getenv('DATABASE_PATH'));
  $pdo = new PDO($dsn, getenv('DATABASE_USERNAME'), getenv('DATABASE_PASSWORD'));
  $pdo->query('SELECT 1');
  echo "db-ok\n";
} catch (Throwable $e) {
  echo 'db-fail: ' . $e->getMessage() . "\n";
}

$socket = @fsockopen(getenv('REDIS_HOST'), (int) getenv('REDIS_PORT'), $errno, $errstr, 2);
if ($socket) {
  fwrite($socket, "PING\r\n");
  echo trim(fgets($socket)) === '+PONG' ? "redis-ok\n" : "redis-fail\n";
  fclose($socket);
} else {
  echo "redis-fail: $errstr\n";
}

echo 'hook=' . trim(@file_get_contents(__DIR__ . '/hook.txt')) . "\n";
echo 'deploy=' . trim(@file_get_contents(__DIR__ . '/deploy.txt')) . "\n";
