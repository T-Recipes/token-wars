'use strict';
// Pre-show check: makes a few small real calls with the stage settings and
// reports in plain words whether the demo is ready, including whether the
// caching drop will show. Costs a few cents. Never prints the key.
const { loadEnv } = require('../lib/env.js');
const { registerSecret, safeLog, redactString } = require('../lib/redact.js');
const { loadContent, ROOT } = require('../lib/content.js');
const { createHarness, buildSystem } = require('../public/shared/harness.js');
const { formatUSD, formatTokens } = require('../public/shared/cost.js');

(async () => {
  let content;
  try {
    content = loadContent();
  } catch (e) {
    safeLog('NOT READY: ' + e.message + ' (' + redactString(e.detail || '') + ')');
    process.exit(1);
  }
  const env = loadEnv(ROOT);
  const key = env.ANTHROPIC_API_KEY || '';
  registerSecret(key);
  if (!key) {
    safeLog('NOT READY: no ANTHROPIC_API_KEY in .env');
    process.exit(1);
  }
  const d = content.demo;
  const harness = createHarness({ apiKey: key, pricing: content.pricing, timeoutMs: (d.timeoutSeconds || 45) * 1000 });
  const cats = content.knowledge.categories;
  const relevant = content.knowledge.defaultRelevant || [];
  const picker = (content.pricing.picker || []).map((p) => p.model).filter((m) => content.pricing.models[m]);
  const main = picker.includes(d.model) ? d.model : picker[0];
  const req = (model, version, mode, caching, question, extra) => ({
    model,
    maxTokens: d.maxTokens || 4096,
    effort: d.effort || undefined,
    caching,
    question,
    settings: { model, caching, promptVersion: version, contextMode: mode },
    system: buildSystem({
      prompt: content.prompts[version],
      dataText: content.campaignText,
      pages: (mode === 'full' ? cats : cats.filter((c) => relevant.includes(c.id))).flatMap((c) => c.pages),
      caching,
      cacheLibrary: mode === 'full',
    }),
    ...extra,
  });

  let ok = true;
  let spent = 0;
  try {
    for (const model of picker) {
      const first = await harness.call(req(model, 'before', 'full', false, 'In one sentence, which campaign had the best completion rate?'));
      spent += first.cost.total;
      safeLog('ok    ' + first.modelLabel + ' answered in ' + (first.latencyMs / 1000).toFixed(1) + 's for ' + formatUSD(first.cost.total) + '.');
    }
    const combos = [];
    for (const model of picker) {
      combos.push([model, 'before', 'full']);
      if (model === main) combos.push([model, 'after', 'full'], [model, 'before', 'relevant'], [model, 'after', 'relevant']);
    }
    for (const [model, version, mode] of combos) {
      const warm = await harness.call(req(model, version, mode, true, 'Reply with the single word OK.', { maxTokens: 16, allowEmpty: true }));
      const next = await harness.call(req(model, version, mode, true, 'In one sentence, which campaign spent the most?'));
      spent += warm.cost.total + next.cost.total;
      const label = next.modelLabel + ', ' + (version === 'after' ? 'clean rules' : 'messy rules') + ', ' + (mode === 'full' ? 'send everything' : 'send only what\u2019s needed');
      if (next.usage.cacheRead > 0) {
        const drop = Math.round((1 - next.cost.inputSide / next.cost.inputSideUncached) * 100);
        safeLog('ok    reuse works: ' + label + ' reused ' + formatTokens(next.usage.cacheRead) + ' tokens, instruction cost down ' + drop + '%.');
      } else {
        ok = false;
        safeLog('WARN  no reuse: ' + label + '. ' + (next.cacheNote || 'The instructions may be below the model\u2019s minimum size.'));
      }
    }
  } catch (e) {
    safeLog('NOT READY: ' + e.message);
    if (e.detail) safeLog('  detail: ' + redactString(e.detail));
    process.exit(1);
  }
  safeLog((ok ? 'READY' : 'READY, but reusing instructions will not show a drop in the combinations marked WARN') + '. This check cost ' + formatUSD(spent) + '.');
  if (content.placeholders.length) safeLog('Note: still using sample content in ' + content.placeholders.join(', '));
})();
