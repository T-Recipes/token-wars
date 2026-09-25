'use strict';
// Static file serving and security headers shared by the stage server and
// the standalone giveaway server.
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function securityHeaders(res, { allowAnthropic = false, allowWatch = null, crossOriginRead = false } = {}) {
  let connect = allowAnthropic ? "'self' https://api.anthropic.com" : "'self'";
  // The stage page's "Watch my app" tab reads live totals from the watch
  // proxy, a separate local process on its own port. Only added to the one
  // page that shows that tab, and only for loopback addresses.
  if (allowWatch) connect += ' http://127.0.0.1:' + allowWatch + ' http://localhost:' + allowWatch;
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      'connect-src ' + connect,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // The watch proxy's own live-data endpoints opt out of same-origin here so
  // the stage page (a different port on this machine) can read them; every
  // other response stays locked to same-origin.
  res.setHeader('Cross-Origin-Resource-Policy', crossOriginRead ? 'cross-origin' : 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Cache-Control', 'no-store');
}

// Serve a file from `dir` only; rejects traversal and dotfiles.
function serveFile(res, dir, rel, headerOpts) {
  const base = path.resolve(dir);
  const abs = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (abs !== base && !abs.startsWith(base + path.sep)) return notFound(res);
  if (path.relative(base, abs).split(path.sep).some((seg) => seg.startsWith('.'))) return notFound(res);
  fs.readFile(abs, (err, buf) => {
    if (err) return notFound(res);
    securityHeaders(res, headerOpts);
    // The logo carries its colours in an inline <style>; SVG can't run script under default-src 'none'.
    if (path.extname(abs) === '.svg') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function notFound(res) {
  securityHeaders(res);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function sendJSON(res, status, obj, headerOpts) {
  securityHeaders(res, headerOpts);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Only accept requests addressed to this machine, and POSTs from this page.
// Blocks DNS-rebinding and other sites in the same browser from using the demo.
// `allowLoopbackOrigin` widens the POST/Origin check from "this exact page"
// to "any port on this same machine": only the watch proxy sets it, since its
// /api/reset is meant to be called from the stage page's tab on a different
// port, and both ends are still loopback-only either way.
function isLocalRequest(req, port, { allowLoopbackOrigin = false } = {}) {
  const host = String(req.headers.host || '');
  const okHosts = ['127.0.0.1:' + port, 'localhost:' + port];
  if (!okHosts.includes(host)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    const selfOrigins = okHosts.map((h) => 'http://' + h);
    if (origin) {
      const ok = selfOrigins.includes(origin) || (allowLoopbackOrigin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin));
      if (!ok) return false;
    }
    if (!origin && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return false;
  }
  return true;
}

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = { securityHeaders, serveFile, notFound, sendJSON, isLocalRequest, readBody };
