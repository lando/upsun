'use strict';

const http = require('http');
const {execFileSync} = require('child_process');

const port = process.env.PORT || 8888;

http.createServer((req, res) => {
  const lines = [
    `app=${process.env.PLATFORM_APPLICATION_NAME}`,
    `start=${process.env.PLATFORM_APP_COMMAND}`,
  ];
  try {
    execFileSync('mysql', [
      '-h', process.env.DATABASE_HOST,
      '-P', process.env.DATABASE_PORT,
      '-u', process.env.DATABASE_USERNAME,
      `-p${process.env.DATABASE_PASSWORD}`,
      process.env.DATABASE_PATH,
      '-e', 'SELECT 1',
    ]);
    lines.push('db-ok');
  } catch (error) {
    lines.push(`db-fail: ${error.message}`);
  }
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end(lines.join('\n') + '\n');
}).listen(port);
