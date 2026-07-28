import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { server as wisp } from '@mercuryworkshop/wisp-js/server';

// Configure wisp-js options
wisp.options.allow_private_ips = true;
wisp.options.allow_loopback_ips = true;

const host = process.env.HOST || '0.0.0.0';
const port = parseInt(process.env.PORT || '8080', 10);

const staticDir = path.resolve(process.env.STATIC_DIR || './browser.js/packages/chrome/dist');
const sandboxDir = path.resolve(process.env.SANDBOX_DIR || './browser.js/packages/sandbox');
const firefoxDir = path.resolve(process.env.FIREFOX_DIR || './dist/firefox');

const CACHE_30_DAYS = 'public, max-age=2592000';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('cross-origin-resource-policy', 'cross-origin');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-embedder-policy', 'require-corp');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net data: blob: ws: wss:;"
  );
}

function serveStaticFile(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawPath = parsedUrl.pathname;

  // Handle /ff redirect
  if (rawPath === '/ff') {
    const target = parsedUrl.search ? `/ff/${parsedUrl.search}` : '/ff/';
    res.statusCode = 301;
    res.setHeader('Location', target);
    return res.end();
  }

  let baseDir;
  let relativePath;

  if (rawPath.startsWith('/ff/') || rawPath === '/ff/') {
    baseDir = firefoxDir;
    relativePath = rawPath.slice(4);
  } else if (
    rawPath.startsWith('/sandbox/') ||
    rawPath === '/sandbox' ||
    rawPath === '/sandbox/' ||
    rawPath === '/controller.html' ||
    rawPath === '/controller.sw.js' ||
    rawPath === '/sw.js'
  ) {
    baseDir = sandboxDir;
    if (rawPath === '/sandbox' || rawPath === '/sandbox/') {
      relativePath = 'controller.html';
    } else if (rawPath.startsWith('/sandbox/')) {
      relativePath = rawPath.slice(9);
    } else {
      relativePath = rawPath.slice(1);
    }
  } else {
    baseDir = staticDir;
    relativePath = rawPath.slice(1);
  }

  if (!relativePath || relativePath === '') {
    relativePath = 'index.html';
  }

  const targetPath = path.resolve(baseDir, relativePath);

  // Prevent directory traversal escape
  if (!targetPath.startsWith(baseDir)) {
    res.statusCode = 403;
    return res.end('403 Forbidden');
  }

  tryServeFile(req, res, targetPath, baseDir, relativePath);
}

function tryServeFile(req, res, targetPath, baseDir, relativePath) {
  fs.stat(targetPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback: if file doesn't have an extension, try index.html
      if (!path.basename(relativePath).includes('.')) {
        const fallbackPath = path.resolve(baseDir, 'index.html');
        if (fallbackPath !== targetPath) {
          return tryServeFile(req, res, fallbackPath, baseDir, 'index.html');
        }
      }
      res.statusCode = 404;
      return res.end('404 Not Found');
    }

    const modifiedSecs = Math.floor(stats.mtimeMs / 1000);
    const etag = `"${stats.size.toString(16)}-${modifiedSecs.toString(16)}"`;
    const lastModified = stats.mtime.toUTCString();

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && (ifNoneMatch.trim() === etag || ifNoneMatch.includes(etag))) {
      res.statusCode = 304;
      res.setHeader('Cache-Control', CACHE_30_DAYS);
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModified);
      return res.end();
    }

    const ifModifiedSince = req.headers['if-modified-since'];
    if (ifModifiedSince && ifModifiedSince.trim() === lastModified) {
      res.statusCode = 304;
      res.setHeader('Cache-Control', CACHE_30_DAYS);
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModified);
      return res.end();
    }

    const contentType = mime.lookup(targetPath) || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', CACHE_30_DAYS);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);

    const stream = fs.createReadStream(targetPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('500 Internal Server Error');
      }
    });
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  serveStaticFile(req, res);
});

server.on('upgrade', (req, socket, head) => {
  wisp.routeRequest(req, socket, head);
});

server.listen(port, host, () => {
  console.log(`Browser & Wisp Server listening on http://${host}:${port}`);
});
