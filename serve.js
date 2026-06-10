// Petit serveur local pour le Bonus Hunt Manager.
// Usage: node serve.js  (puis ouvrir http://localhost:8765)
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT) || 8765;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
};

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(base)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(url.parse(req.url).pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    let filePath = safeJoin(ROOT, pathname);
    if (!filePath) {
      res.writeHead(403); return res.end('Forbidden');
    }
    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      fs.readFile(filePath, (e, data) => {
        if (e) {
          // Fallback SPA : mime le rewrite Vercel "/(.*)" → index.html
          // pour que /hunt, /blackjack, /pharaon... fonctionnent en dev local.
          const accept = String(req.headers['accept'] || '');
          const ext = path.extname(pathname).toLowerCase();
          const looksLikeHtmlNav = accept.includes('text/html') && !ext;
          if (looksLikeHtmlNav) {
            return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
              if (e2) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('404 Not Found: ' + pathname);
              }
              res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(html);
            });
          }
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('404 Not Found: ' + pathname);
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      });
    });
  } catch (err) {
    res.writeHead(500); res.end('500 ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Bonus Hunt Manager — serveur local');
  console.log('  ---------------------------------');
  console.log('  Ouvre ton navigateur sur :');
  console.log('    http://localhost:' + PORT + '/');
  console.log('');
  console.log('  Ctrl+C pour arreter.');
});
