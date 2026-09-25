'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createHarness, createSession, buildSystem, ENDPOINT } = require('../public/shared/harness.js');
const { computeCost, normalizeUsage } = require('../public/shared/cost.js');
const { friendly, MESSAGES } = require('../public/shared/errors.js');
const pricing = require('../config/pricing.json');

const KEY = 'sk-ant-api03-TESTSECRET-abcdefghijklmnop';
const MODEL = 'claude-sonnet-5';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

const ok = (usage, text = 'Hello') => ({
  ok: true, status: 200,
  json: async () => ({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text }], usage, stop_reason: 'end_turn' }),
});

test('cost math follows the price table', () => {
  const p = pricing.models[MODEL];
  const c = computeCost({ input: 1_000_000, output: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000 }, p);
  assert.strictEqual(c.input, p.input);
  assert.strictEqual(c.output, p.output);
  assert.strictEqual(c.cacheWrite, p.cacheWrite5m);
  assert.strictEqual(c.cacheRead, p.cacheRead);
  assert.strictEqual(c.total, p.input + p.output + p.cacheWrite5m + p.cacheRead);
  assert.strictEqual(c.inputSideUncached, 3 * p.input);
});

test('usage fields map from the API names', () => {
  assert.deepStrictEqual(
    normalizeUsage({ input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }),
    { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 }
  );
});

test('cache_control is added only when caching is on', () => {
  const on = buildSystem({ prompt: 'p', pages: [{ category: 'a', title: 't', text: 'x' }], caching: true, cacheLibrary: true });
  const off = buildSystem({ prompt: 'p', pages: [{ category: 'a', title: 't', text: 'x' }], caching: false, cacheLibrary: true });
  assert.deepStrictEqual(on[0].cache_control, { type: 'ephemeral' });
  assert.deepStrictEqual(on[1].cache_control, { type: 'ephemeral' });
  assert.ok(!off.some((b) => b.cache_control));
  const rel = buildSystem({ prompt: 'p', pages: [{ category: 'a', title: 't', text: 'x' }], caching: true, cacheLibrary: false });
  assert.ok(rel[0].cache_control && !rel[1].cache_control);
});

test('harness sends the key only to the Anthropic endpoint and never returns it', async () => {
  const f = fakeFetch(() => ok({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 }));
  const h = createHarness({ apiKey: KEY, pricing, fetchImpl: f });
  const call = await h.call({ model: MODEL, system: buildSystem({ prompt: 'p', caching: true }), question: 'q', caching: true });
  assert.strictEqual(f.calls.length, 1);
  assert.strictEqual(f.calls[0].url, ENDPOINT);
  assert.strictEqual(ENDPOINT, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(f.calls[0].init.headers['x-api-key'], KEY);
  assert.ok(!f.calls[0].init.body.includes(KEY));
  assert.strictEqual(call.answer, 'Hello');
  assert.strictEqual(call.usage.cacheWrite, 2000);
  assert.ok(!JSON.stringify(call).includes(KEY));
  assert.ok(!JSON.stringify(h).includes(KEY));
  assert.ok(!Object.values(h).some((v) => v === KEY));
});

test('upstream error text never reaches the user-facing message', async () => {
  const f = fakeFetch(() => ({
    ok: false, status: 401,
    json: async () => ({ error: { type: 'authentication_error', message: 'invalid x-api-key ' + KEY } }),
  }));
  const h = createHarness({ apiKey: KEY, pricing, fetchImpl: f });
  await assert.rejects(h.call({ model: MODEL, system: [], question: 'q' }), (e) => {
    assert.strictEqual(e.kind, 'auth');
    assert.ok(!e.message.includes(KEY));
    assert.ok(!JSON.stringify(friendly(e.kind)).includes('x-api-key'));
    return true;
  });
});

test('status codes map to readable messages', async () => {
  for (const [status, kind] of [[429, 'rate_limit'], [529, 'overloaded'], [500, 'server'], [400, 'bad_request'], [404, 'not_found']]) {
    const h = createHarness({ apiKey: KEY, pricing, fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
    await assert.rejects(h.call({ model: MODEL, system: [], question: 'q' }), (e) => e.kind === kind);
  }
  for (const m of Object.values(MESSAGES)) {
    assert.ok(!/stack|undefined|null|Error:/i.test(m.title + m.message));
  }
});

test('timeouts and network failures become friendly errors', async () => {
  const slow = createHarness({
    apiKey: KEY, pricing, timeoutMs: 50,
    fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
  });
  await assert.rejects(slow.call({ model: MODEL, system: [], question: 'q' }), (e) => e.kind === 'timeout');
  const down = createHarness({ apiKey: KEY, pricing, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.call({ model: MODEL, system: [], question: 'q' }), (e) => e.kind === 'network');
  const nokey = createHarness({ apiKey: '', pricing, fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(nokey.call({ model: MODEL, system: [], question: 'q' }), (e) => e.kind === 'no_key');
});

test('empty answers are reported, except for warm-up calls', async () => {
  const f = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'thinking', thinking: '' }], usage: { input_tokens: 1, output_tokens: 16 }, stop_reason: 'max_tokens' }) });
  const h = createHarness({ apiKey: KEY, pricing, fetchImpl: async () => f() });
  await assert.rejects(h.call({ model: MODEL, system: [], question: 'q' }), (e) => e.kind === 'empty');
  const warm = await h.call({ model: MODEL, system: [], question: 'q', allowEmpty: true, kind: 'warmup' });
  assert.strictEqual(warm.kind, 'warmup');
});

test('session keeps running totals', async () => {
  const h = createHarness({ apiKey: KEY, pricing, fetchImpl: async () => ok({ input_tokens: 1000, output_tokens: 100 }) });
  const s = createSession();
  s.add(await h.call({ model: MODEL, system: [], question: 'a' }));
  s.add(await h.call({ model: MODEL, system: [], question: 'b', kind: 'warmup' }));
  const snap = s.snapshot();
  assert.strictEqual(snap.calls, 2);
  assert.strictEqual(snap.questions, 1);
  assert.strictEqual(snap.tokens.input, 2000);
  assert.ok(Math.abs(snap.totalCost - 2 * (1000 * 2 + 100 * 10) / 1e6) < 1e-12);
  s.reset();
  assert.strictEqual(s.snapshot().calls, 0);
});
