<?php
header('Content-Type: text/plain');
echo 'php=' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION . "\n";
echo 'xsl=' . (extension_loaded('xsl') ? 'yes' : 'no') . "\n";
echo 'redis=' . (extension_loaded('redis') ? 'yes' : 'no') . "\n";
echo 'imap=' . (extension_loaded('imap') ? 'yes' : 'no') . "\n";
echo 'node=' . trim((string) shell_exec('node -v 2>/dev/null')) . "\n";
