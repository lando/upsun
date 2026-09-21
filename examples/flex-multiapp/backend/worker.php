<?php
while (true) {
  file_put_contents(__DIR__ . '/web/worker.txt', 'worker-alive');
  sleep(2);
}
