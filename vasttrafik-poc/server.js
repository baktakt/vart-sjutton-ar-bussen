import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

const SCRIPTS = {
  static:       'scripts/test-static.js',
  tripupdates:  'scripts/test-tripupdates.js',
  vehicles:     'scripts/test-vehicles.js',
  vasttrafik:   'scripts/test-vasttrafik-api.js',
  situations:   'scripts/test-traffic-situations.js',
  tripdetails:  'scripts/test-trip-details.js',
};

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // SSE endpoint: /run/:script
  const runMatch = url.pathname.match(/^\/run\/(\w+)$/);
  if (runMatch) {
    const scriptKey = runMatch[1];
    const scriptPath = SCRIPTS[scriptKey];
    if (!scriptPath) {
      res.writeHead(404).end('Unknown script');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (type, data) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('start', { script: scriptKey, time: new Date().toISOString() });

    const child = spawn('node', [scriptPath], {
      cwd: __dirname,
      env: { ...process.env },
    });

    child.stdout.on('data', chunk => send('stdout', chunk.toString()));
    child.stderr.on('data', chunk => send('stderr', chunk.toString()));
    child.on('close', code => {
      send('done', { code });
      res.end();
    });

    req.on('close', () => child.kill());
    return;
  }

  // Static file serving from /public
  let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`UI running at http://localhost:${PORT}`);
  console.log('Make sure .env has your Trafiklab keys.');
});
