// Anthropic Messages API harness. Shared by the Node server (stage) and the
// browser (giveaway). The endpoint is fixed: credentials only ever go here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cost.js'), require('./errors.js'));
  } else {
    (root.TW = root.TW || {}).harness = factory(root.TW.cost, root.TW.errors);
  }
})(typeof self !== 'undefined' ? self : this, function (cost, errors) {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2023-06-01';
  const { DemoError } = errors;

  // Two system blocks: [instructions + data] then [knowledge pages].
  // When caching is on, cache_control marks the instructions block; the
  // library block is also marked when it is stable (full library mode).
  function buildSystem({ prompt, dataText, pages, caching, cacheLibrary }) {
    let head = '<instructions>\n' + (prompt || '').trim() + '\n</instructions>';
    if (dataText) head += '\n\n<data>\n' + dataText.trim() + '\n</data>';
    const blocks = [{ type: 'text', text: head }];
    if (caching) blocks[0].cache_control = { type: 'ephemeral' };
    if (pages && pages.length) {
      const body = pages
        .map((p) => '<page category="' + esc(p.category) + '" title="' + esc(p.title) + '">\n' + p.text.trim() + '\n</page>')
        .join('\n\n');
      const lib = { type: 'text', text: '<knowledge_library>\n' + body + '\n</knowledge_library>' };
      if (caching && cacheLibrary) lib.cache_control = { type: 'ephemeral' };
      blocks.push(lib);
    }
    return blocks;
  }

  function esc(s) {
    return String(s || '').replace(/[<>"&]/g, '');
  }

  function extractText(resp) {
    return ((resp && resp.content) || [])
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  let seq = 0;

  function createHarness(opts) {
    // The key lives only in this closure. It is never returned, logged, or serialised.
    let apiKey = opts.apiKey || '';
    const pricing = opts.pricing;
    const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    const browser = !!opts.browser;
    const timeoutMs = opts.timeoutMs || 45000;

    async function call(req) {
      if (!apiKey) throw new DemoError('no_key');
      const price = cost.priceFor(req.pricing || pricing, req.model);
      if (!price) throw new DemoError('not_found', 'model missing from price table');

      const body = {
        model: req.model,
        max_tokens: req.maxTokens || 1024,
        system: req.system,
        messages: [{ role: 'user', content: req.question }],
      };
      if (req.effort && price.supportsEffort) body.output_config = { effort: req.effort };

      const headers = {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      };
      if (browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs || timeoutMs);
      const started = Date.now();
      let res;
      let json;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        json = await res.json().catch(() => null);
        if (!json && controller.signal.aborted) throw new DemoError('timeout');
      } catch (e) {
        if (e instanceof DemoError) throw e;
        if (controller.signal.aborted) throw new DemoError('timeout');
        throw new DemoError('network', (e && e.name) || 'fetch failed');
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const type = json && json.error && json.error.type;
        const upstream = json && json.error && typeof json.error.message === 'string' ? json.error.message : '';
        let kind = errors.classifyStatus(res.status, type);
        if (kind === 'bad_request' && /too long|too many tokens|context (window|length)/i.test(upstream)) kind = 'too_large';
        throw new DemoError(kind, 'HTTP ' + res.status + ' ' + (type || '') + ' ' + upstream.slice(0, 300));
      }

      const usage = cost.normalizeUsage(json && json.usage);
      let answer = extractText(json);
      if (!answer && !req.allowEmpty) throw new DemoError('empty', 'stop_reason=' + (json && json.stop_reason));
      if (answer && json && json.stop_reason === 'max_tokens') answer += '\n\n(Answer cut off at the length limit.)';

      const c = cost.computeCost(usage, price);
      const PER = 1e6;
      let cacheNote = '';
      let cacheState = '';
      if (req.caching && usage.cacheWrite === 0 && usage.cacheRead === 0) {
        cacheState = 'short';
        const words = Math.round(((price.minCacheableTokens || 1024) * 0.75) / 100) * 100;
        cacheNote = 'Too short for this AI to cache. ' + (price.label || 'This model') +
          ' only caches instructions of about ' + cost.formatTokens(words) + ' words or more.';
      } else if (usage.cacheRead > 0) {
        cacheState = 'read';
        cacheNote = 'Instructions cached from an earlier question: ' + cost.formatUSD(c.cacheRead) +
          ' instead of ' + cost.formatUSD((usage.cacheRead * price.input) / PER) + '.';
      } else if (usage.cacheWrite > 0) {
        cacheState = 'write';
        cacheNote = 'Cached these instructions. The next question pays ' +
          cost.formatUSD((usage.cacheWrite * price.cacheRead) / PER) + ' for them instead of ' +
          cost.formatUSD((usage.cacheWrite * price.input) / PER) + '.';
      }

      return {
        id: ++seq,
        at: Date.now(),
        kind: req.kind || 'ask',
        label: req.label || req.question,
        settings: req.settings || {},
        model: req.model,
        modelLabel: price.label || req.model,
        usage,
        cost: c,
        answer,
        cacheNote,
        cacheState,
        latencyMs: Date.now() - started,
        stopReason: (json && json.stop_reason) || '',
      };
    }

    return {
      call,
      setKey(k) { apiKey = typeof k === 'string' ? k.trim() : ''; },
      clearKey() { apiKey = ''; },
      hasKey() { return !!apiKey; },
      toJSON() { return { harness: true }; },
    };
  }

  function createSession() {
    let s = blank();
    function blank() {
      return {
        calls: 0,
        questions: 0,
        totalCost: 0,
        totalUncached: 0,
        tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
        history: [],
      };
    }
    return {
      add(call) {
        s.calls += 1;
        if (call.kind !== 'warmup') s.questions += 1;
        s.totalCost += call.cost.total;
        s.totalUncached += call.cost.totalUncached;
        for (const k of Object.keys(s.tokens)) s.tokens[k] += call.usage[k];
        s.history.push(summarize(call));
        if (s.history.length > 200) s.history.shift();
      },
      reset() { s = blank(); },
      snapshot() { return JSON.parse(JSON.stringify(s)); },
    };
  }

  // Tracks when each cache prefix was last written or read. The API keeps a
  // cache for 5 minutes after last use, so anything older needs re-warming.
  function createCacheTracker(maxAgeMs) {
    maxAgeMs = maxAgeMs || 270000;
    const seen = new Map();
    const tooShort = new Set();
    return {
      note(sig, call) {
        if (!call || !call.settings || !call.settings.caching) return;
        if (call.usage.cacheWrite > 0 || call.usage.cacheRead > 0) {
          seen.set(sig, Date.now());
          tooShort.delete(sig);
        } else {
          tooShort.add(sig);
        }
      },
      needsWarm(sig) {
        if (tooShort.has(sig)) return false;
        const t = seen.get(sig);
        return !t || Date.now() - t > maxAgeMs;
      },
      reset() { seen.clear(); tooShort.clear(); },
    };
  }

  function summarize(call) {
    return {
      id: call.id,
      kind: call.kind,
      label: call.label,
      settings: call.settings,
      model: call.model,
      usage: call.usage,
      cost: call.cost,
      latencyMs: call.latencyMs,
    };
  }

  function cacheSignature(settings, prompt) {
    return (settings.model || '') + '|' + (settings.effort || '') + '|' + settings.promptVersion + '|' + settings.contextMode + '|' + String(prompt || '').length;
  }

  return { ENDPOINT, buildSystem, extractText, createHarness, createSession, createCacheTracker, cacheSignature };
});
