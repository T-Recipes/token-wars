'use strict';
// Standalone server for the giveaway page. Serves static files only: it never
// sees the API key (the browser talks to api.anthropic.com directly).
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { serveFile, notFound, isLocalRequest } = require('../lib/http.js');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const FIRST_PORT = 4174;
const SHARED = new Set(['cost.js', 'errors.js', 'relevance.js', 'harness.js', 'app.js', 'stage.css']);
const LOGO = '/assets/V3_Stacked_TR_RIQ_White.svg';

function start(port, triesLeft) {
  const server = http.createServer((req, res) => {
    if (!isLocalRequest(req, port)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    const p = new URL(req.url, 'http://' + HOST).pathname;
    if (p === '/' || p === '/giveaway') {
      res.writeHead(302, { Location: '/giveaway/' });
      return res.end();
    }
    if (p === '/giveaway/') return serveFile(res, __dirname, 'index.html', { allowAnthropic: true });
    if (p === '/giveaway/giveaway.js') return serveFile(res, __dirname, 'giveaway.js');
    if (p === '/config/pricing.json') return serveFile(res, path.join(ROOT, 'config'), 'pricing.json');
    if (p === LOGO) return serveFile(res, path.join(ROOT, 'assets'), path.basename(LOGO));
    if (p.startsWith('/shared/') && SHARED.has(p.slice(8))) return serveFile(res, path.join(ROOT, 'public', 'shared'), p.slice(8));
    return notFound(res);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && triesLeft > 0) return start(port + 1, triesLeft - 1);
    process.stdout.write('Could not start: ' + (e.code || 'error') + '. Close other copies of Token Wars and try again.\n');
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    const url = 'http://' + HOST + ':' + port + '/giveaway/';
    process.stdout.write('\n  Token Wars is running.\n\n  Open this address in your browser:  ' + url + '\n\n  Keep this window open while you use it. Close it to stop.\n\n');
    if (process.argv.includes('--open')) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      execFile(cmd, [url], () => {});
    }
  });
}

start(FIRST_PORT, 10);
