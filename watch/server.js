'use strict';
// Watch my app: a local, loopback-only proxy that sits between your own
// project and Anthropic. Point your Anthropic client's base URL at this
// server instead of api.anthropic.com, and it forwards every request and
// response byte-for-byte, unchanged, while reading just the `usage` numbers
// off to the side to keep a running dollar total on the dashboard here.
//
// Trust boundary, stated plainly: unlike the giveaway (where your key goes
// straight from your own browser to Anthropic and never touches anything of
// ours), this proxy runs on your own machine and does see your API key and
// your traffic pass through it, in memory, on their way to Anthropic. It
// never writes the key, your prompts, or any answer text to disk or to the
// console: only token counts, the model name, cost, and timing are kept,
// and only in memory, cleared when this process stops.
const http = require('http');
const https = require('https');

const { loadEnv } = require('../lib/env.js');
const { securityHeaders, serveFile, notFound, sendJSON, isLocalRequest } = require('../lib/http.js');
const { createSession } = require('../public/shared/harness.js');
const cost = require('../public/shared/cost.js');
const pricing = require('../config/pricing.json');

const ROOT = require('path').resolve(__dirname, '..');
const WATCH_DIR = __dirname;
const SHARED_DIR = require('path').join(ROOT, 'public', 'shared');

const HOST = '127.0.0.1';
const UPSTREAM_PATH = '/v1/messages';
const MAX_BODY = 10 * 1024 * 1024; // 10 MB: generous for large cached system prompts
const UPSTREAM_TIMEOUT_MS = 120000;

const env = loadEnv(ROOT);
const portArg = (process.argv.find((a) => a.startsWith('--port=')) || '').slice(7);
const PORT = Number(portArg) || Number(env.WATCH_PORT) || 4174;

// The only place the upstream target is decided: always Anthropic's real API,
// never something a request can steer. The env override exists only so the
// test suite can point this at a local fake Anthropic instead of the real
// service; it is not read from, or settable by, any incoming request.
const UPSTREAM_HOST = process.env.WATCH_UPSTREAM_HOST || env.WATCH_UPSTREAM_HOST || 'api.anthropic.com';
const UPSTREAM_PORT = Number(process.env.WATCH_UPSTREAM_PORT || env.WATCH_UPSTREAM_PORT) || 443;
const UPSTREAM_MODULE = (process.env.WATCH_UPSTREAM_PROTOCOL || env.WATCH_UPSTREAM_PROTOCOL) === 'http' ? http : https;

const session = createSession();
let seq = 0;

// Live dashboard viewers: an open response per browser tab, written to as
// real calls come in. No history is written to disk; a fresh page load gets
// the current in-memory snapshot and then only new calls after that.
const clients = new Set();

function broadcast(call) {
  const line = 'data: ' + JSON.stringify(call) + '\n\n';
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

function recordCall(info, fallbackModel, startedAt) {
  const model = (info && info.model) || fallbackModel || 'unknown';
  const usage = cost.normalizeUsage(info && info.usage);
  const price = cost.priceFor(pricing, model);
  const c = price
    ? cost.computeCost(usage, price)
    : { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, inputSide: 0, total: 0, inputSideUncached: 0, totalUncached: 0 };
  const call = {
    id: ++seq,
    at: Date.now(),
    kind: 'watch',
    label: model,
    settings: {},
    model,
    modelLabel: (price && price.label) || model,
    priced: !!price,
    usage,
    cost: c,
    latencyMs: Date.now() - startedAt,
  };
  session.add(call);
  broadcast(call);
}

// Reads Anthropic's server-sent event stream one line at a time and pulls the
// token counts out of it as they arrive, without buffering or delaying the
// bytes going back to the caller.
function makeUsageTap(onFinal) {
  let buf = '';
  let usage = null;
  let model = null;
  let done = false;
  return function push(chunkText) {
    buf += chunkText;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      let evt;
      try {
        evt = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (evt.type === 'message_start' && evt.message) {
        model = evt.message.model || model;
        usage = Object.assign({}, evt.message.usage);
      } else if (evt.type === 'message_delta' && evt.usage) {
        if (usage) usage.output_tokens = evt.usage.output_tokens;
      } else if (evt.type === 'message_stop' && usage && !done) {
        done = true;
        onFinal({ usage, model });
      }
    }
  };
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // Drain the rest of the socket without buffering it, so the request
        // still completes cleanly and the response below isn't cut off.
        if (!over) { over = true; reject(new Error('too large')); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// The one route that ever leaves this machine: forwards to Anthropic and
// relays the response back untouched. Everything else is served locally.
async function handleMessages(req, res) {
  if (req.method !== 'POST') return notFound(res);
  let bodyBuf;
  try {
    bodyBuf = await readRawBody(req, MAX_BODY);
  } catch {
    return sendJSON(res, 413, { type: 'error', error: { type: 'invalid_request_error', message: 'Request body too large.' } });
  }

  let parsed = null;
  try {
    parsed = JSON.parse(bodyBuf.toString('utf8'));
  } catch {
    /* Not JSON: forward as-is and let Anthropic return the real error. */
  }
  const requestModel = parsed && typeof parsed.model === 'string' ? parsed.model : null;
  const wantsStream = !!(parsed && parsed.stream);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(k.toLowerCase())) continue;
    headers[k] = v;
  }
  headers['content-length'] = String(bodyBuf.length);
  headers['accept-encoding'] = 'identity'; // so the response can be read as plain text/JSON here

  const started = Date.now();
  const upstreamReq = UPSTREAM_MODULE.request(
    { hostname: UPSTREAM_HOST, port: UPSTREAM_PORT, path: UPSTREAM_PATH, method: 'POST', headers, timeout: UPSTREAM_TIMEOUT_MS },
    (upstreamRes) => {
      const contentType = String(upstreamRes.headers['content-type'] || '');
      res.writeHead(upstreamRes.statusCode || 502, { 'Content-Type': contentType || 'application/json; charset=utf-8' });

      if (wantsStream || contentType.includes('text/event-stream')) {
        const tap = makeUsageTap((info) => recordCall(info, requestModel, started));
        upstreamRes.on('data', (chunk) => {
          res.write(chunk);
          tap(chunk.toString('utf8'));
        });
        upstreamRes.on('end', () => res.end());
      } else {
        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () => {
          const buf = Buffer.concat(chunks);
          res.end(buf);
          try {
            const json = JSON.parse(buf.toString('utf8'));
            if (json && json.usage) recordCall({ usage: json.usage, model: json.model || requestModel }, requestModel, started);
          } catch {
            /* Upstream error or non-JSON body: nothing to meter, already relayed above. */
          }
        });
      }
    }
  );
  upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('timeout')));
  upstreamReq.on('error', () => {
    if (!res.headersSent) sendJSON(res, 502, { type: 'error', error: { type: 'api_error', message: 'Could not reach Anthropic from the watch proxy.' } });
    else res.end();
  });
  upstreamReq.end(bodyBuf);
}

function handleEvents(req, res) {
  securityHeaders(res, { crossOriginRead: true });
  addCors(req, res);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// The stage page's "Watch my app" tab reads these two endpoints from a
// different port (its own server), so the browser treats it as a
// cross-origin request. Reflect the origin back only when it is another
// process on this same machine; nothing here accepts credentials or cookies.
function addCors(req, res) {
  const origin = req.headers.origin || '';
  if (/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

const server = http.createServer((req, res) => {
  try {
    if (!isLocalRequest(req, PORT, { allowLoopbackOrigin: true })) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    const url = new URL(req.url, 'http://' + HOST);
    const p = url.pathname;

    if (p === UPSTREAM_PATH) return handleMessages(req, res).catch(() => sendJSON(res, 500, { type: 'error', error: { type: 'api_error', message: 'Unexpected error in the watch proxy.' } }));

    if (req.method !== 'GET' && req.method !== 'HEAD' && p !== '/api/reset') return notFound(res);
    if (p === '/') return serveFile(res, WATCH_DIR, 'dashboard.html');
    if (p === '/dashboard.js') return serveFile(res, WATCH_DIR, 'dashboard.js');
    if (p === '/dashboard.css') return serveFile(res, WATCH_DIR, 'dashboard.css');
    if (p === '/shared/stage.css') return serveFile(res, SHARED_DIR, 'stage.css');
    if (p === '/events') return handleEvents(req, res);
    if (p === '/api/session') {
      addCors(req, res);
      return sendJSON(res, 200, { ok: true, session: session.snapshot() }, { crossOriginRead: true });
    }
    if (p === '/api/reset' && req.method === 'POST') {
      session.reset();
      addCors(req, res);
      return sendJSON(res, 200, { ok: true, session: session.snapshot() }, { crossOriginRead: true });
    }
    return notFound(res);
  } catch {
    try {
      sendJSON(res, 500, { ok: false });
    } catch {
      /* socket already gone */
    }
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    process.stdout.write('Port ' + PORT + ' is already in use. Close the other copy, or set WATCH_PORT=<number> in .env.\n');
  } else {
    process.stdout.write('Watch proxy could not start: ' + (e.code || e.name || 'error') + '\n');
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    [
      '',
      '  Watch my app: a live meter for your own project\'s real Anthropic calls',
      '',
      '    Dashboard:      http://' + HOST + ':' + PORT + '/',
      '    Point your app at:  http://' + HOST + ':' + PORT + '  (instead of https://api.anthropic.com)',
      '',
      '  Nothing here is written to disk. Stopping this process clears the running totals.',
      '  Press Ctrl+C to stop.',
      '',
    ].join('\n')
  );
});
