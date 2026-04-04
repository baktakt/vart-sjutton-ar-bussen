import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// api/run/ → up two levels → project root → scripts/
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');

const ALLOWED = {
  static:      'test-static.js',
  tripupdates: 'test-tripupdates.js',
  vehicles:    'test-vehicles.js',
  vasttrafik:  'test-vasttrafik-api.js',
};

export default function handler(req, res) {
  const scriptKey  = req.query.script;
  const scriptFile = ALLOWED[scriptKey];

  if (!scriptFile) {
    res.status(404).end('Unknown script');
    return;
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

  send('start', { script: scriptKey, time: new Date().toISOString() });

  const child = spawn('node', [path.join(SCRIPTS_DIR, scriptFile)], {
    cwd: path.resolve(SCRIPTS_DIR, '..'),
    env: { ...process.env },
  });

  child.stdout.on('data', chunk => send('stdout', chunk.toString()));
  child.stderr.on('data', chunk => send('stderr', chunk.toString()));
  child.on('close', code => { send('done', { code }); res.end(); });
  req.on('close', () => child.kill());
}
