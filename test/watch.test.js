'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WATCH_PORT = 4199;
const FAKE_PORT = 4200;
const BASE = 'http://127.0.0.1:' + WATCH_PORT;
const FAKE_KEY = 'sk-ant-api03-WATCHTESTSECRET-abcdefghijklmnop';

// A tiny stand-in for api.anthropic.com so the test never touches the real
// network. It echoes back usage numbers baked into the question so each test
// can assert on exact totals.
function startFakeAnthropic() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw); } catch { /* ignore */ }
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
          res.write('event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { model: body.model, usage: { input_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } }) + '\n\n');
          res.write('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }) + '\n\n');
          res.write('event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }) + '\n\n');
          res.write('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n');
          res.end();
          return;
        }
        if (req.headers['x-api-key'] !== FAKE_KEY) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key ' + req.headers['x-api-key'] } }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_fake', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'hello from the fake' }],
          usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }));
      });
    });
    srv.listen(FAKE_PORT, '127.0.0.1', () => resolve(srv));
  });
}

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/session'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('watch proxy did not start');
}

test('watch proxy: meters real traffic without altering it, and leaks no secrets', async (t) => {
  const fake = await startFakeAnthropic();
  const srv = spawn(process.execPath, [path.join(ROOT, 'watch', 'server.js'), '--port=' + WATCH_PORT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WATCH_UPSTREAM_HOST: '127.0.0.1', WATCH_UPSTREAM_PORT: String(FAKE_PORT), WATCH_UPSTREAM_PROTOCOL: 'http' },
  });
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  srv.stderr.on('data', (d) => (out += d));
  t.after(() => { srv.kill(); fake.close(); });
  await waitUp();

  // Non-streaming call: response body reaches the caller byte-for-byte, and
  // usage/cost show up in the session a moment later.
  const askBody = { model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] };
  const res = await fetch(BASE + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': FAKE_KEY }, body: JSON.stringify(askBody) });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.content[0].text, 'hello from the fake');
  assert.strictEqual(json.usage.input_tokens, 1000);

  let session;
  for (let i = 0; i < 20; i++) {
    session = await (await fetch(BASE + '/api/session')).json();
    if (session.session.calls >= 1) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.strictEqual(session.session.calls, 1);
  assert.strictEqual(session.session.tokens.input, 1000);
  assert.strictEqual(session.session.tokens.output, 100);
  assert.ok(session.session.totalCost > 0);

  // Streaming call: bytes are relayed live and the usage from message_delta
  // (the final, cumulative count) is what gets recorded.
  const streamRes = await fetch(BASE + '/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': FAKE_KEY },
    body: JSON.stringify({ ...askBody, stream: true }),
  });
  const streamText = await streamRes.text();
  assert.match(streamText, /message_stop/);
  assert.match(streamRes.headers.get('content-type') || '', /text\/event-stream/);

  for (let i = 0; i < 20; i++) {
    session = await (await fetch(BASE + '/api/session')).json();
    if (session.session.calls >= 2) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.strictEqual(session.session.calls, 2);
  assert.strictEqual(session.session.tokens.output, 140, 'streamed output uses the final message_delta count, not the first chunk');

  // An upstream 401 (bad key) still relays through untouched.
  const badRes = await fetch(BASE + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'sk-ant-not-the-real-one' }, body: JSON.stringify(askBody) });
  assert.strictEqual(badRes.status, 401);

  // Reset clears the running totals.
  const afterReset = await (await fetch(BASE + '/api/reset', { method: 'POST' })).json();
  assert.strictEqual(afterReset.session.calls, 0);

  // Dashboard pages are served locally; nothing here is proxied.
  const page = await fetch(BASE + '/');
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.strictEqual((await fetch(BASE + '/dashboard.js')).status, 200);
  assert.strictEqual((await fetch(BASE + '/dashboard.css')).status, 200);
  assert.strictEqual((await fetch(BASE + '/nope')).status, 404);
  assert.strictEqual((await fetch(BASE + '/shared/../../.env')).status, 404);

  // A body over the size cap is rejected before it ever reaches Anthropic.
  const bigRes = await fetch(BASE + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': FAKE_KEY }, body: 'x'.repeat(11 * 1024 * 1024) });
  assert.strictEqual(bigRes.status, 413);

  // Foreign Host headers (DNS rebinding, another site's fetch) never reach the proxy.
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: WATCH_PORT, path: '/v1/messages', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, resolve);
    req.on('error', reject);
    req.end('{}');
  });
  assert.strictEqual(wrongHost.statusCode, 403);

  // The key and any prompt/answer text never appear in this process's own output.
  assert.ok(!out.includes(FAKE_KEY), 'the API key must never be printed by the watch proxy');
  assert.ok(!out.includes('hello from the fake'), 'answer text must never be printed by the watch proxy');
});
