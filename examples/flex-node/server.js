const http = require('http');
const {Client} = require('pg');

const port = process.env.PORT || 8888;
const relationships = JSON.parse(Buffer.from(process.env.PLATFORM_RELATIONSHIPS || '', 'base64').toString() || '{}');

http.createServer(async (req, res) => {
  const lines = [
    `app=${process.env.PLATFORM_APPLICATION_NAME}`,
    `greeting=${process.env.GREETING}`,
    `relationships=${Object.keys(relationships).join(',')}`,
    `port=${port}`,
  ];
  try {
    const client = new Client({
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      user: process.env.DATABASE_USERNAME,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_PATH,
    });
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    lines.push('db-ok');
  } catch (error) {
    lines.push(`db-fail: ${error.message}`);
  }
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end(lines.join('\n') + '\n');
}).listen(port);
