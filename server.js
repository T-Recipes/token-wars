'use strict';
// Token Wars stage server. Run: npm start   (rehearsal without API: npm run mock)
const http = require('http');
const path = require('path');

const { loadEnv } = require('./lib/env.js');
const { registerSecret, redactDeep, redactString, safeLog } = require('./lib/redact.js');
const { loadContent, ROOT } = require('./lib/content.js');
const { serveFile, notFound, sendJSON, isLocalRequest, readBody } = require('./lib/http.js');
const { createMockFetch } = require('./lib/mock.js');
const { createHarness, createSession, createCacheTracker, cacheSignature, buildSystem } = require('./public/shared/harness.js');
const { pickRelevant } = require('./public/shared/relevance.js');
const { estimateTokens } = require('./public/shared/cost.js');
const { friendly, DemoError } = require('./public/shared/errors.js');

const MOCK = process.argv.includes('--mock');
const HOST = '127.0.0.1';
const LOGO = '/assets/V3_Stacked_TR_RIQ_White.svg';

const env = loadEnv(ROOT);
const portArg = (process.argv.find((a) => a.startsWith('--port=')) || '').slice(7);
const PORT = Number(portArg) || Number(env.PORT) || 4173;
// Not this server's own port: the separate "Watch my app" proxy (watch/server.js),
// if the presenter has started it. Only used so the stage page knows which
// port to talk to for its live totals; never started or controlled from here.
const WATCH_PORT = Number(env.WATCH_PORT) || 4174;

let harness;
{
  const boot = loadContent();
  const apiKey = MOCK ? 'mock-mode-no-key' : env.ANTHROPIC_API_KEY || '';
  registerSecret(apiKey);
  delete env.ANTHROPIC_API_KEY;
  harness = createHarness({
    apiKey,
    pricing: boot.pricing,
    timeoutMs: (boot.demo.timeoutSeconds || 45) * 1000,
    fetchImpl: MOCK ? createMockFetch({ pricing: boot.pricing }) : undefined,
  });
}
const session = createSession();
const cacheTracker = createCacheTracker();
let warming = Promise.resolve();

function pickerModels(pricing) {
  const list = (pricing.picker || []).filter((p) => pricing.models[p.model]);
  return list.length ? list : Object.keys(pricing.models).slice(0, 3).map((model) => ({ model }));
}

const EFFORTS = ['low', 'medium', 'high'];

function settingsFrom(body, content) {
  const demo = content.demo;
  const d = demo.defaults || {};
  const allowed = pickerModels(content.pricing).map((p) => p.model);
  const fallback = allowed.includes(demo.model) ? demo.model : allowed[0];
  return {
    model: allowed.includes(body.model) ? body.model : fallback,
    effort: EFFORTS.includes(body.effort) ? body.effort : EFFORTS.includes(demo.effort) ? demo.effort : 'low',
    caching: typeof body.caching === 'boolean' ? body.caching : !!d.caching,
    promptVersion: body.promptVersion === 'after' ? 'after' : body.promptVersion === 'before' ? 'before' : d.promptVersion || 'before',
    contextMode: body.contextMode === 'relevant' ? 'relevant' : body.contextMode === 'full' ? 'full' : d.contextMode || 'full',
  };
}

function relevantFor(content, question, questionId) {
  const preset = (content.demo.questions || []).find((q) => q.id === questionId || q.text === question);
  return pickRelevant(question, content.knowledge.categories, {
    preset: preset && preset.categories,
    fallback: content.knowledge.defaultRelevant || [],
  });
}

function buildRequest(content, settings, question, relevantIds, extra) {
  const cats = content.knowledge.categories;
  const included = settings.contextMode === 'full' ? cats : cats.filter((c) => relevantIds.includes(c.id));
  const pages = included.flatMap((c) => c.pages);
  const system = buildSystem({
    prompt: content.prompts[settings.promptVersion],
    dataText: content.campaignText,
    pages,
    caching: settings.caching,
    cacheLibrary: settings.contextMode === 'full',
  });
  return {
    pricing: content.pricing,
    timeoutMs: (content.demo.timeoutSeconds || 45) * 1000,
    model: settings.model,
    maxTokens: content.demo.maxTokens || 4096,
    effort: settings.effort,
    system,
    question,
    caching: settings.caching,
    settings,
    ...extra,
  };
}

function publicState(content) {
  const defaults = settingsFrom({}, content);
  return {
    ok: true,
    mode: 'stage',
    keyConfigured: harness.hasKey(),
    title: content.demo.title,
    subtitle: content.demo.subtitle,
    logo: LOGO,
    prices: {
      verifiedOn: content.pricing.verifiedOn || '',
      picker: pickerModels(content.pricing).map((p) => ({ model: p.model, ...content.pricing.models[p.model] })),
    },
    defaults,
    questions: (content.demo.questions || []).map((q) => ({ id: q.id, text: q.text, short: q.short || q.text, categories: q.categories || [] })),
    prewarm: content.demo.prewarmCacheOnToggle !== false,
    projection: content.demo.projection || null,
    prompts: content.prompts,
    promptTokens: {
      before: estimateTokens(content.prompts.before),
      after: estimateTokens(content.prompts.after),
    },
    dataTokens: estimateTokens(content.campaignText),
    conflicts: content.conflicts,
    knowledge: {
      libraryName: content.knowledge.libraryName,
      totalFiles: content.knowledge.totalFiles,
      totalTokens: content.knowledge.totalTokens,
      defaultRelevant: content.knowledge.defaultRelevant || [],
      categories: content.knowledge.categories.map((c) => ({
        id: c.id, name: c.name, blurb: c.blurb || '', fileCount: c.fileCount, tokenCount: c.tokenCount, sentTokens: c.sentTokens, keywords: c.keywords || [],
      })),
    },
    getStarted: content.getStarted,
    atScale: content.atScale,
    watchPort: WATCH_PORT,
    session: session.snapshot(),
  };
}

async function warmCache(content, settings, sig) {
  const reqObj = buildRequest(content, settings, 'Reply with the single word OK.', content.knowledge.defaultRelevant || [], {
    kind: 'warmup', label: 'Cache warm-up', maxTokens: 16, allowEmpty: true,
  });
  const p = harness.call(reqObj);
  warming = p.catch(() => {});
  const call = await p;
  session.add(call);
  cacheTracker.note(sig, call);
  logCall(call);
  return call;
}

function fail(res, e) {
  const kind = e instanceof DemoError ? e.kind : 'unknown';
  safeLog('[call] failed:', kind, redactString((e && e.detail) || (e && e.name) || ''));
  sendJSON(res, 200, { ok: false, error: friendly(kind), session: session.snapshot() });
}

function questionFrom(body) {
  const q = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  if (!q) throw new DemoError('input');
  return q;
}

function logCall(call) {
  const u = call.usage;
  safeLog(
    '[call] ' + call.kind + ' ok  in=' + u.input + ' cacheWrite=' + u.cacheWrite + ' cacheRead=' + u.cacheRead +
      ' out=' + u.output + ' $' + call.cost.total.toFixed(5) + ' ' + call.latencyMs + 'ms'
  );
}

async function handleApi(req, res, route) {
  if (route === 'state' && req.method === 'GET') {
    return sendJSON(res, 200, redactDeep(publicState(loadContent())));
  }
  if (req.method !== 'POST') return notFound(res);

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJSON(res, 200, { ok: false, error: friendly('input') });
  }

  try {
    if (route === 'reset') {
      session.reset();
      return sendJSON(res, 200, { ok: true, session: session.snapshot() });
    }

    const content = loadContent();
    const settings = settingsFrom(body, content);

    const prewarm = settings.caching && content.demo.prewarmCacheOnToggle !== false;
    const sig = cacheSignature(settings, content.prompts[settings.promptVersion]);

    if (route === 'warm') {
      if (!prewarm) return sendJSON(res, 200, { ok: true, skipped: true, session: session.snapshot() });
      const call = await warmCache(content, settings, sig);
      return sendJSON(res, 200, redactDeep({ ok: true, call, session: session.snapshot() }));
    }

    if (route === 'ask') {
      const question = questionFrom(body);
      const ids = relevantFor(content, question, body.questionId);
      await warming;
      if (prewarm && cacheTracker.needsWarm(sig)) await warmCache(content, settings, sig).catch(() => {});
      const call = await harness.call(buildRequest(content, settings, question, ids, { kind: 'ask' }));
      session.add(call);
      cacheTracker.note(sig, call);
      logCall(call);
      return sendJSON(res, 200, redactDeep({ ok: true, call, relevant: ids, session: session.snapshot() }));
    }

    if (route === 'compare') {
      const question = questionFrom(body);
      const ids = relevantFor(content, question, body.questionId);
      const on = { ...settings, caching: true };
      const onSig = cacheSignature(on, content.prompts[on.promptVersion]);
      await warming;
      if (cacheTracker.needsWarm(onSig)) await warmCache(content, on, onSig).catch(() => {});
      const variants = [['off', { ...settings, caching: false }], ['on', on]];
      const results = await Promise.allSettled(
        variants.map(([v, s]) => harness.call(buildRequest(content, s, question, ids, { kind: 'compare-' + v })))
      );
      const out = {};
      for (const [i, [v]] of variants.entries()) {
        const r = results[i];
        if (r.status === 'fulfilled') {
          session.add(r.value);
          if (v === 'on') cacheTracker.note(onSig, r.value);
          logCall(r.value);
          out[v] = { ok: true, call: r.value };
        } else {
          const kind = r.reason instanceof DemoError ? r.reason.kind : 'unknown';
          safeLog('[call] failed:', kind, redactString((r.reason && r.reason.detail) || ''));
          out[v] = { ok: false, error: friendly(kind) };
        }
      }
      return sendJSON(res, 200, redactDeep({ ok: true, ...out, relevant: ids, session: session.snapshot() }));
    }

    return notFound(res);
  } catch (e) {
    return fail(res, e);
  }
}

const PUBLIC = path.join(ROOT, 'public');
const GIVEAWAY = path.join(ROOT, 'giveaway');
const ASSETS = path.join(ROOT, 'assets');

const server = http.createServer((req, res) => {
  try {
    if (!isLocalRequest(req, PORT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    const url = new URL(req.url, 'http://' + HOST);
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      return handleApi(req, res, p.slice(5)).catch((e) => fail(res, e));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    if (p === '/') return serveFile(res, PUBLIC, 'index.html', { allowWatch: WATCH_PORT });
    if (p === '/giveaway') {
      res.writeHead(302, { Location: '/giveaway/' });
      return res.end();
    }
    if (p === '/giveaway/') return serveFile(res, GIVEAWAY, 'index.html', { allowAnthropic: true });
    if (p === '/giveaway/giveaway.js') return serveFile(res, GIVEAWAY, 'giveaway.js');
    if (p === '/config/pricing.json') return serveFile(res, path.join(ROOT, 'config'), 'pricing.json');
    if (p.startsWith('/shared/') || p === '/stage.js') return serveFile(res, PUBLIC, p.slice(1));
    if (p === LOGO) return serveFile(res, ASSETS, path.basename(LOGO));
    if (p.startsWith('/assets/')) return serveFile(res, ASSETS, p.slice('/assets/'.length));
    return notFound(res);
  } catch (e) {
    safeLog('[server] request error:', redactString((e && e.name) || 'error'));
    try { sendJSON(res, 200, { ok: false, error: friendly('unknown') }); } catch { /* socket gone */ }
  }
});

process.on('uncaughtException', (e) => safeLog('[server] unexpected error:', redactString((e && e.message) || 'error')));
process.on('unhandledRejection', (e) => safeLog('[server] unexpected rejection:', redactString((e && e.message) || 'error')));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    safeLog('Port ' + PORT + ' is already in use. Close the other copy of the demo, or set PORT=<number> in .env.');
  } else {
    safeLog('Server could not start: ' + redactString(e.code || e.name || 'error'));
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const boot = loadContent();
  const lines = [
    '',
    '  Token Wars demo is running' + (MOCK ? ' in REHEARSAL mode (simulated answers, no API calls)' : ''),
    '',
    '    Stage:     http://' + HOST + ':' + PORT + '/',
    '    Giveaway:  http://' + HOST + ':' + PORT + '/giveaway/',
    '',
    MOCK ? '    API key:   not used in rehearsal mode'
      : harness.hasKey() ? '    API key:   loaded from .env'
      : '    API key:   MISSING. Copy .env.example to .env and add ANTHROPIC_API_KEY, then restart.',
    boot.placeholders.length ? '    Sample content still in: ' + boot.placeholders.join(', ') : '',
    '',
    '  Press Ctrl+C to stop.',
    '',
  ];
  safeLog(lines.join('\n'));
});
