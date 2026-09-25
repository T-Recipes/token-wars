'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHarness, createCacheTracker } = require('../public/shared/harness.js');
const { loadEnv } = require('../lib/env.js');
const pricing = require('../config/pricing.json');

const KEY = 'sk-ant-api03-TESTSECRET-abcdefghijklmnop';

const respond = (json, status = 200) => async () => ({ ok: status < 300, status, json: async () => json });

test('cache tracker asks for a re-warm once the cache is stale, but not for prompts too short to cache', async () => {
  const t = createCacheTracker(20);
  assert.strictEqual(t.needsWarm('a'), true);
  t.note('a', { settings: { caching: true }, usage: { cacheWrite: 2000, cacheRead: 0 } });
  assert.strictEqual(t.needsWarm('a'), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(t.needsWarm('a'), true);
  t.note('b', { settings: { caching: true }, usage: { cacheWrite: 0, cacheRead: 0 } });
  assert.strictEqual(t.needsWarm('b'), false);
});

test('effort is sent only to models that support it', async () => {
  const bodies = [];
  const h = createHarness({
    apiKey: KEY, pricing,
    fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return respond({ content: [{ type: 'text', text: 'x' }], usage: {} })(); },
  });
  await h.call({ model: 'claude-sonnet-5', system: [], question: 'q', effort: 'low' });
  await h.call({ model: 'claude-haiku-4-5', system: [], question: 'q', effort: 'low' });
  assert.deepStrictEqual(bodies[0].output_config, { effort: 'low' });
  assert.strictEqual(bodies[1].output_config, undefined);
});

test('answers cut off at the length limit say so', async () => {
  const h = createHarness({ apiKey: KEY, pricing, fetchImpl: respond({ content: [{ type: 'text', text: 'Partial' }], usage: {}, stop_reason: 'max_tokens' }) });
  const call = await h.call({ model: 'claude-sonnet-5', system: [], question: 'q' });
  assert.match(call.answer, /cut off/);
});

test('a too-long prompt maps to the "Too much text" message', async () => {
  const h = createHarness({ apiKey: KEY, pricing, fetchImpl: respond({ error: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum' } }, 400) });
  await assert.rejects(h.call({ model: 'claude-sonnet-5', system: [], question: 'q' }), (e) => e.kind === 'too_large');
});

test('.env values tolerate quotes and trailing comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-env-'));
  fs.writeFileSync(path.join(dir, '.env'), 'A=plain # note\nB="quoted # kept"\nexport C=x\n# D=no\n');
  assert.deepStrictEqual(loadEnv(dir), { A: 'plain', B: 'quoted # kept', C: 'x' });
  fs.rmSync(dir, { recursive: true, force: true });
});
