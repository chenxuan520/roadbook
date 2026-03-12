import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// test/ 位于仓库根目录下，这里将静态服务根目录设为仓库根
const repoRoot = path.resolve(__dirname, '..');
const port = Number(process.env.E2E_PORT || 4173);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function safeResolve(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.posix.normalize(decoded).replace(/^\/+/, '');
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = req.url || '/';
    if (requestUrl === '/' || requestUrl === '') {
      res.statusCode = 302;
      res.setHeader('Location', '/static/index.html');
      res.end();
      return;
    }

    const filePath = safeResolve(repoRoot, requestUrl);
    if (!filePath) {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || stat.isDirectory()) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    const data = await fs.readFile(filePath);
    res.end(data);
  } catch (e) {
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[test] static server listening on http://127.0.0.1:${port}`);
});
