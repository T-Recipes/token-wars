'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { redactString, redactDeep, registerSecret } = require('../lib/redact.js');
const { loadContent } = require('../lib/content.js');
const { createMockFetch } = require('../lib/mock.js');
const { createHarness, buildSystem } = require('../public/shared/harness.js');
const { estimateTokens } = require('../public/shared/cost.js');
const { packageProblems } = require('../scripts/package-check.js');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4198;
const BASE = 'http://127.0.0.1:' + PORT;

test('redaction removes registered secrets and anything shaped like a key', () => {
  registerSecret('super-secret-value-123');
  assert.strictEqual(redactString('a super-secret-value-123 b'), 'a [redacted] b');
  assert.strictEqual(redactString('key sk-ant-api03-abcdefgh'), 'key [redacted]');
  assert.deepStrictEqual(redactDeep({ apiKey: 'x', nested: { 'x-api-key': 'y', ok: 'sk-ant-zzzzzzzzzz' } }), { nested: { ok: '[redacted]' } });
});

test('content loads and every highlighted line exists and is not blank', () => {
  const c = loadContent();
  for (const v of ['before', 'after']) {
    const lines = c.prompts[v].split(/\r?\n/);
    for (const n of [...(c.conflicts[v].red || []), ...(c.conflicts[v].amber || []), ...(c.conflicts[v].green || [])]) {
      assert.ok(lines[n - 1] && lines[n - 1].trim(), v + ' line ' + n + ' should exist');
    }
  }
  const before = c.prompts.before.split(/\r?\n/);
  const askRepeats = c.conflicts.before.amber.filter((n) => /question/i.test(before[n - 1])).length;
  assert.ok(askRepeats >= 12, 'the closing-question rule is marked as repeated (' + askRepeats + ' lines)');
  assert.ok(c.knowledge.categories.every((cat) => cat.pages.length > 0));
  for (const f of ['config/demo.json', 'config/knowledge_center.json', 'data/demo_campaigns.json']) {
    assert.ok(c.placeholders.includes(f), f + ' is still flagged as a stub for the terminal');
  }
});

test('teaching prompts: messy is at least 2.5 times the clean one, both long enough to reuse, no stray disclosure text', () => {
  const c = loadContent();
  const ratio = estimateTokens(c.prompts.before) / estimateTokens(c.prompts.after);
  assert.ok(ratio >= 2.5, 'messy prompt is only ' + ratio.toFixed(2) + ' times the clean one');
  assert.ok(c.prompts.after.replace(/\s+$/, '').split(/\r?\n/).length <= 90, 'clean prompt stays short');
  for (const v of ['before', 'after']) {
    assert.ok(estimateTokens(c.prompts[v]) > 1100, v + ' prompt must stay above 1,024 tokens');
    assert.ok(!/placeholder|sample|demo|rehears/i.test(c.prompts[v]), v);
    assert.ok(!/\bCONTEXT\b/.test(c.prompts[v]) && !/builder|scoring|weighting|benchmark|intent/i.test(c.prompts[v]), v + ' carries no product-specific terms');
  }
  assert.ok((c.prompts.before.match(/closing question/gi) || []).length >= 8, 'the repeated closing-question rule is kept');
  assert.ok((c.prompts.after.match(/closing question/gi) || []).length <= 3, 'and stated once in the clean version');
  for (const cap of [/non-negotiable/i, /MAXIMUM 3 SENTENCES/, /Maximum 15 words/, /MANDATORY RESPONSE FORMAT/]) assert.match(c.prompts.before, cap);
});

test('prompt_before_raw.txt stays out of git, and no tracked file carries its lines', () => {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  let tracked;
  try { tracked = git(['ls-files']).split('\n').filter(Boolean); } catch { return; }
  assert.ok(!tracked.some((f) => /prompt_before_raw/.test(f)), 'raw prompt must never be tracked');
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^prompt_before_raw\.txt$/m);
  const raw = path.join(ROOT, 'prompt_before_raw.txt');
  if (!fs.existsSync(raw)) return;
  const rawLines = [...new Set(fs.readFileSync(raw, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 40))];
  for (const f of tracked.concat(['prompts/prompt_before_cleanup.md', 'prompts/prompt_after_cleanup.md'])) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p) || /\.(png|svg|zip)$/.test(f)) continue;
    const text = fs.readFileSync(p, 'utf8');
    const hit = rawLines.find((l) => text.includes(l));
    assert.ok(!hit, f + ' contains a line of the raw prompt');
    const idents = new Set(fs.readFileSync(raw, 'utf8').match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) || []);
    if (/^prompts\//.test(f)) for (const id of idents) assert.ok(!text.includes(id), f + ' contains an internal identifier');
  }
});

test('giveaway package check refuses stage content, secrets, key-shaped text and raw prompt lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-pkg-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('ok.js', 'fine');
  put('.env', 'X=1');
  put('prompts/p.md', 'x');
  put('data/d.json', '{}');
  put('prompt_before_raw.txt', 'x');
  put('notes.txt', 'x');
  put('config/get_started.json', '{}');
  put('leak.js', 'const k = "sk-ant-api03-abcdefghijk";');
  const raw = path.join(ROOT, 'prompt_before_raw.txt');
  const rawLine = fs.existsSync(raw) && fs.readFileSync(raw, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l.length >= 40);
  if (rawLine) put('copied.js', '// ' + rawLine);
  const problems = packageProblems(dir, ROOT).join('\n');
  for (const f of ['.env', 'prompts/p.md', 'data/d.json', 'prompt_before_raw.txt', 'notes.txt', 'config/get_started.json', 'leak.js']) assert.ok(problems.includes(f), f + ' should be refused');
  if (rawLine) assert.match(problems, /copied\.js contains text from prompt_before_raw/);
  assert.ok(!problems.includes('ok.js'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mock mode reproduces the caching drop across two different questions', async () => {
  const c = loadContent();
  const h = createHarness({ apiKey: 'mock', pricing: c.pricing, fetchImpl: createMockFetch({ pricing: c.pricing, latencyMs: [1, 2] }) });
  const pages = c.knowledge.categories.flatMap((x) => x.pages);
  const sys = (caching) => buildSystem({ prompt: c.prompts.before, dataText: c.campaignText, pages, caching, cacheLibrary: true });
  const q1 = await h.call({ model: c.demo.model, system: sys(false), question: 'first question' });
  await h.call({ model: c.demo.model, system: sys(true), question: 'OK', allowEmpty: true, maxTokens: 16 });
  const q2 = await h.call({ model: c.demo.model, system: sys(true), question: 'a different question', caching: true });
  assert.ok(q2.usage.cacheRead > 0);
  assert.ok(q2.cost.inputSide < q1.cost.inputSide * 0.5);
});

test('server: state never contains a key, rejects foreign origins, and blocks file access', async (t) => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--mock', '--port=' + PORT], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  t.after(() => srv.kill());
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/state'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const stateText = await (await fetch(BASE + '/api/state')).text();
  assert.ok(!/sk-ant-/.test(stateText));
  assert.ok(!/ANTHROPIC_API_KEY/.test(stateText));
  const state = JSON.parse(stateText);
  assert.ok(!('mock' in state) && !('placeholders' in state), 'nothing in state can reveal rehearsal mode or stub content');
  assert.match(state.prices.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(state.prices.picker.length, 3);
  for (const p of state.prices.picker) for (const k of ['input', 'cacheWrite5m', 'cacheRead', 'output']) assert.ok(p[k] > 0, p.model + ' ' + k);
  const inputs = state.prices.picker.map((p) => p.input);
  assert.deepStrictEqual([...inputs].sort((a, b) => a - b), inputs, 'picker runs cheapest to most expensive');
  assert.ok(state.getStarted && state.getStarted.tools.length === 3);

  const post = (route, body) => fetch(BASE + '/api/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  assert.deepStrictEqual(state.prices.picker.map((p) => p.model), ['claude-sonnet-5', 'claude-opus-5-5', 'claude-fable-5-1']);
  assert.strictEqual(state.defaults.effort, 'low');
  const cheap = await post('ask', { question: 'Which campaign had the best completion rate?', model: 'claude-sonnet-5', caching: false });
  const dear = await post('ask', { question: 'Which campaign had the best completion rate?', model: 'claude-fable-5-1', caching: false });
  assert.strictEqual(cheap.call.model, 'claude-sonnet-5');
  assert.strictEqual(dear.call.model, 'claude-fable-5-1');
  assert.ok(dear.call.cost.total > cheap.call.cost.total * 4, 'same question costs more on the premium model');
  const high = await post('ask', { question: 'Which campaign had the best completion rate?', model: 'claude-sonnet-5', effort: 'high', caching: false });
  assert.strictEqual(high.call.settings.effort, 'high');
  assert.ok(high.call.usage.output > cheap.call.usage.output, 'higher effort writes more');
  const oddEffort = await post('ask', { question: 'x', effort: 'max' });
  assert.strictEqual(oddEffort.call.settings.effort, 'low', 'unknown effort falls back to the default');
  assert.ok(!/rehears|simulat|placeholder/i.test(cheap.call.answer), 'rehearsal answers carry no disclosure text');
  const odd = await post('ask', { question: 'x', model: 'not-a-model' });
  assert.strictEqual(odd.call.model, state.defaults.model, 'unknown models fall back to the default');

  const logo = await fetch(BASE + '/assets/V3_Stacked_TR_RIQ_White.svg');
  assert.strictEqual(logo.status, 200);
  assert.match(logo.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(logo.headers.get('content-security-policy'), /default-src 'none'/);
  assert.strictEqual((await fetch(BASE + '/assets/../.env')).status, 404);

  const evil = await fetch(BASE + '/api/ask', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{"question":"x"}' });
  assert.strictEqual(evil.status, 403);

  for (const p of ['/.env', '/.env.example', '/server.js', '/shared/../../.env', '/config/demo.json', '/config/get_started.json', '/prompts/prompt_before_cleanup.md', '/prompt_before_raw.txt', '/assets/%2e%2e/prompt_before_raw.txt', '/shared/%2e%2e/%2e%2e/.env']) {
    const r = await fetch(BASE + p);
    assert.strictEqual(r.status, 404, p);
  }

  const err = await (await fetch(BASE + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"question":"simulate error"}' })).json();
  assert.strictEqual(err.ok, false);
  assert.ok(err.error.title && err.error.message);
  assert.ok(!/at |Error|stack/.test(JSON.stringify(err.error)));

  const stage = await fetch(BASE + '/');
  // The stage page's own connect-src widens to the (loopback-only) watch proxy port
  // so its "Watch my app" tab can read live totals from that separate process.
  assert.match(stage.headers.get('content-security-policy'), /connect-src 'self' http:\/\/127\.0\.0\.1:4174 http:\/\/localhost:4174;/);
  const give = await fetch(BASE + '/giveaway/');
  assert.match(give.headers.get('content-security-policy'), /connect-src 'self' https:\/\/api\.anthropic\.com;/);
  assert.ok(!/sk-ant-/.test(out));
});

test('no source file references outside systems or stores a key', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist', 'artifacts'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|json|html|md|css)$/.test(e.name)) files.push(p);
    }
  };
  walk(ROOT);
  for (const f of files) {
    if (f.endsWith(path.join('test', 'server.test.js')) || f.endsWith(path.join('scripts', 'package-check.js')) || f.endsWith(path.join('scripts', 'check-layout.js'))) continue;
    let text = fs.readFileSync(f, 'utf8');
    // The sidebar logo is a plain link to the company site; it is never fetched (connect-src forbids it).
    if (f.endsWith(path.join('public', 'shared', 'app.js'))) text = text.replace("'https://www.techrecipes.com'", '').replace('Tech Recipes (opens www.techrecipes.com)', '');
    // The Get Started tab's "Tools" QR panel is a deliberate, plain marketing link
    // (confirmed fine to publish), not an internal-only name or leaked secret.
    if (f.endsWith(path.join('config', 'get_started.json'))) text = text.replace(/rootiq(\.ai)?/gi, '');
    assert.ok(!/rootiq|supabase|gtppnbtrejfwktywkzbz|krnoytfxrfpsplfsnbsv/i.test(text), f);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(text), f);
    const hosts = (text.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map((u) => u.toLowerCase());
    for (const h of hosts) {
      assert.ok(/^https?:\/\/(127\.0\.0\.1|localhost|api\.anthropic\.com|nodejs\.org|console\.anthropic\.com|calendly\.com|www\.techrecipes\.com|evil\.example|platform\.claude\.com|tinyurl\.com|api\.qrserver\.com)/.test(h) || /\.md$/.test(f), f + ' references ' + h);
    }
  }
});
