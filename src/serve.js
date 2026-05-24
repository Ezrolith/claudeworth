#!/usr/bin/env node
// Tiny static server for the dashboard, used by the preview workflow.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.PORT) || 5174;
const ROOT = resolve(process.argv[2] || './dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    const full = resolve(join(ROOT, path));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    const data = await readFile(full);
    const ext = full.slice(full.lastIndexOf('.')).toLowerCase();
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + req.url);
  }
});

server.listen(PORT, () => {
  console.log(`claudeworth static server listening on http://localhost:${PORT} (serving ${ROOT})`);
});
