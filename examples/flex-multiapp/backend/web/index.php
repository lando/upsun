<?php
header('Content-Type: text/plain');
echo 'app=' . getenv('PLATFORM_APPLICATION_NAME') . "\n";
echo 'tz=' . getenv('TZ') . "\n";
echo 'memory_limit=' . ini_get('memory_limit') . "\n";
echo 'session=' . ini_get('session.save_handler') . "\n";
echo 'host=' . gethostbyname('example.internal') . "\n";
$rels = json_decode(base64_decode(getenv('PLATFORM_RELATIONSHIPS')), true);
echo 'relationships=' . implode(',', array_keys($rels)) . "\n";
$connect = function ($prefix) {
  $dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s',
    getenv("{$prefix}_HOST"),
    getenv("{$prefix}_PORT"),
    getenv("{$prefix}_PATH")
  );
  return new PDO(
    $dsn,
    getenv("{$prefix}_USERNAME"),
    getenv("{$prefix}_PASSWORD"),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
  );
};
try {
  $admin = $connect('DATABASE');
  $admin->exec('CREATE TABLE IF NOT EXISTS legacy.items (id INT)');
  echo "admin-ok\n";
} catch (Throwable $e) {
  echo 'admin-fail: ' . $e->getMessage() . "\n";
}
try {
  $reporter = $connect('REPORTS');
  $reporter->query('SELECT COUNT(*) FROM items');
  echo "reporter-read-ok\n";
  try {
    $reporter->exec('CREATE TABLE denied (id INT)');
    echo "reporter-write-allowed\n";
  } catch (Throwable $e) {
    echo "reporter-ro\n";
  }
} catch (Throwable $e) {
  echo 'reporter-fail: ' . $e->getMessage() . "\n";
}
echo 'hook=' . trim(@file_get_contents(__DIR__ . '/hook.txt')) . "\n";
echo 'worker=' . trim(@file_get_contents(__DIR__ . '/worker.txt')) . "\n";
