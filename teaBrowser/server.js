'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = process.env.PORT || 3001;
const BACKEND     = { hostname: 'localhost', port: process.env.BACKEND_PORT || 3000 };
const STATIC_DIR  = __dirname;
const SHARED_CSS  = path.join(__dirname, '../backend/public/shared.css');

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

function proxyToBackend(req, res) {
  const options = {
    hostname: BACKEND.hostname,
    port:     BACKEND.port,
    path:     req.url,
    method:   req.method,
    headers:  req.headers,
  };
  const proxy = http.request(options, backendRes => {
    res.writeHead(backendRes.statusCode, backendRes.headers);
    backendRes.pipe(res);
  });
  proxy.on('error', () => {
    res.writeHead(502);
    res.end('Backend unavailable');
  });
  req.pipe(proxy);
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/shared.css') {
    return serveFile(SHARED_CSS, res);
  }

  if (url.startsWith('/api/') || url.startsWith('/images/')) {
    return proxyToBackend(req, res);
  }

  const filePath = url === '/' ? path.join(STATIC_DIR, 'index.html')
                               : path.join(STATIC_DIR, url);
  serveFile(filePath, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TeaBrowser running on port ${PORT}`);
});
