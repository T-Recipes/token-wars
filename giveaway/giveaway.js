// Giveaway backend: runs entirely in this browser tab. The API key and prompts
// are held in memory only (no browser storage, cookies, or files) and the key is
// sent only to api.anthropic.com. Closing or reloading the tab forgets them.
(function () {
  const TW = window.TW;
  const { h } = TW.app;
  const { estimateTokens, formatTokens, formatUSD } = TW.cost;

  const STOP = new Set('about above after again against their there these those which while where would could should other being having because every under between through during before within without from with that this have will your into than then them they what when were been also only more most such some very just over each'.split(' '));

  const MAX_PAGES = 12;
  const KEY_SHAPE = /sk-ant-[A-Za-z0-9_\-]{6,}/;
  const DEFAULT_MODEL = 'claude-sonnet-5';

  function pickerOf(p) {
    return ((p && p.picker) || []).filter((x) => p.models[x.model]);
  }

  function pricesFor(p) {
    return { verifiedOn: (p && p.verifiedOn) || '', picker: pickerOf(p).map((x) => ({ model: x.model, ...p.models[x.model] })) };
  }

  let pricing = null;
  let harness = null;
  const session = TW.harness.createSession();
  const cacheTracker = TW.harness.createCacheTracker();
  let warming = Promise.resolve();
  let api = null;

  const user = {
    before: '',
    after: '',
    reference: '',
    questions: '',
  };

  function pagesFrom(text) {
    let chunks = String(text || '').split(/^\s*---+\s*$/m).map((s) => s.trim()).filter(Boolean);
    if (chunks.length > MAX_PAGES) chunks = chunks.slice(0, MAX_PAGES - 1).concat(chunks.slice(MAX_PAGES - 1).join('\n\n'));
    return chunks.map((chunk, i) => {
      const first = chunk.split(/\r?\n/)[0].replace(/^#+\s*/, '').trim();
      const title = (first || 'Page ' + (i + 1)).slice(0, 60);
      const counts = new Map();
      for (const w of chunk.toLowerCase().match(/[a-z]{5,}/g) || []) {
        if (!STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map((e) => e[0]);
      const titleWords = (title.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w));
      return {
        id: 'page-' + (i + 1),
        name: title,
        text: chunk,
        fileCount: 1,
        tokenCount: estimateTokens(chunk),
        keywords: [...new Set(titleWords.concat(top))],
      };
    });
  }

  function buildState() {
    const cats = pagesFrom(user.reference);
    const qs = user.questions.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 6)
      .map((text, i) => ({ id: 'uq-' + (i + 1), text, short: text.length > 42 ? text.slice(0, 40) + '\u2026' : text }));
    return {
      ok: true,
      mode: 'giveaway',
      title: 'Token Wars',
      subtitle: 'What do your AI instructions really cost?',
      labels: { before: 'Your instructions', after: 'Your cleaned-up version', beforeShort: 'Yours', afterShort: 'Cleaned up' },
      hovers: {
        rules: 'Yours is the set of instructions you pasted; cleaned up is the second version you pasted, so you can see what each one costs.',
        send: 'Send everything attaches all of your reference pages to every question; send only what\u2019s needed attaches just the pages that match the question.',
      },
      prices: pricesFor(pricing),
      defaults: { model: pickerOf(pricing).some((p) => p.model === DEFAULT_MODEL) ? DEFAULT_MODEL : undefined, effort: 'low', caching: true },
      prewarm: true,
      prompts: { before: user.before, after: user.after },
      conflicts: {},
      questions: qs,
      projection: { label: 'At 50,000 questions a month', questionsPerMonth: 50000 },
      knowledge: {
        libraryName: 'Your reference material',
        totalFiles: cats.length,
        totalTokens: cats.reduce((n, c) => n + c.tokenCount, 0),
        defaultRelevant: cats.length ? [cats[0].id] : [],
        categories: cats,
      },
      session: session.snapshot(),
    };
  }

  function requestFor(settings, question, questionId, extra) {
    const st = buildState();
    const cats = st.knowledge.categories;
    const preset = st.questions.find((q) => q.id === questionId);
    const ids = TW.relevance.pickRelevant(question, cats, {
      preset: preset && preset.categories,
      fallback: st.knowledge.defaultRelevant,
    });
    const included = settings.contextMode === 'full' ? cats : cats.filter((c) => ids.includes(c.id));
    const prompt = settings.promptVersion === 'after' && user.after.trim() ? user.after : user.before;
    return {
      ids,
      sig: TW.harness.cacheSignature(settings, prompt),
      req: {
        model: settings.model,
        maxTokens: 4096,
        effort: settings.effort || 'low',
        system: TW.harness.buildSystem({
          prompt,
          pages: included.map((c) => ({ category: c.id, title: c.name, text: c.text })),
          caching: settings.caching,
          cacheLibrary: settings.contextMode === 'full',
        }),
        question,
        caching: settings.caching,
        settings,
        ...extra,
      },
    };
  }

  function errorOf(e) {
    return TW.errors.friendly(e && e.kind ? e.kind : 'unknown');
  }

  function ready() {
    if (!harness || !harness.hasKey()) return { ok: false, error: { title: 'No API key yet', message: 'Paste your API key on the Your setup screen first.' } };
    if (!user.before.trim()) return { ok: false, error: { title: 'No instructions yet', message: 'Paste your AI\u2019s instructions on the Your setup screen first.' } };
    return null;
  }

  const backend = {
    extraViews: [{ id: 'setup', label: 'Your setup', build: buildSetup }],
    rulesCompare: false,

    async init() {
      try {
        const res = await fetch('/config/pricing.json', { credentials: 'same-origin' });
        pricing = await res.json();
      } catch {
        return { ok: false, error: { title: 'Could not start', message: 'The price table did not load. Close this tab and start the program again.' } };
      }
      harness = TW.harness.createHarness({ pricing, browser: true, timeoutMs: 45000 });
      return buildState();
    },

    async ask({ question, questionId, settings }) {
      const notReady = ready();
      if (notReady) return { ...notReady, session: session.snapshot() };
      const { req, ids, sig } = requestFor(settings, question, questionId, { kind: 'ask' });
      await warming;
      if (settings.caching && cacheTracker.needsWarm(sig)) await backend.warm(settings);
      try {
        const call = await harness.call(req);
        session.add(call);
        cacheTracker.note(sig, call);
        return { ok: true, call, relevant: ids, session: session.snapshot() };
      } catch (e) {
        return { ok: false, error: errorOf(e), session: session.snapshot() };
      }
    },

    async compare({ question, questionId, settings }) {
      const notReady = ready();
      if (notReady) return { ...notReady, session: session.snapshot() };
      await warming;
      const on = { ...settings, caching: true };
      const onReq = requestFor(on, question, questionId, { kind: 'compare-on' });
      if (cacheTracker.needsWarm(onReq.sig)) await backend.warm(on);
      const out = { ok: true };
      const reqs = [['off', requestFor({ ...settings, caching: false }, question, questionId, { kind: 'compare-off' }).req], ['on', onReq.req]];
      const results = await Promise.allSettled(reqs.map(([, req]) => harness.call(req)));
      reqs.forEach(([v], i) => {
        const r = results[i];
        if (r.status === 'fulfilled') {
          session.add(r.value);
          if (v === 'on') cacheTracker.note(onReq.sig, r.value);
          out[v] = { ok: true, call: r.value };
        } else out[v] = { ok: false, error: errorOf(r.reason) };
      });
      out.session = session.snapshot();
      return out;
    },

    async warm(settings) {
      if (!settings.caching || ready()) return { ok: true, skipped: true, session: session.snapshot() };
      const { req, sig } = requestFor(settings, 'Reply with the single word OK.', null, {
        kind: 'warmup', label: 'Caching the instructions', maxTokens: 16, allowEmpty: true,
      });
      const p = harness.call(req);
      warming = p.catch(() => {});
      try {
        const call = await p;
        session.add(call);
        cacheTracker.note(sig, call);
        return { ok: true, call, session: session.snapshot() };
      } catch (e) {
        return { ok: false, error: errorOf(e), session: session.snapshot() };
      }
    },

    async reset() {
      session.reset();
      return { ok: true, session: session.snapshot() };
    },
  };

  function buildSetup(view, appApi) {
    api = appApi;
    const keyInput = h('input', {
      type: 'password', autocomplete: 'new-password', spellcheck: 'false', 'data-lpignore': 'true', 'data-1p-ignore': 'true',
      'aria-label': 'Anthropic API key', placeholder: 'Paste your Anthropic API key',
    });
    const keyState = h('div', { class: 'key-state', text: 'No key loaded' });
    const useKey = h('button', { type: 'button', class: 'primary', text: 'Use key' });
    const forget = h('button', { type: 'button', class: 'ghost-btn', text: 'Forget key' });

    const applyKey = () => {
      const value = keyInput.value;
      keyInput.value = '';
      if (!value.trim()) return;
      if (!/^sk-ant-/.test(value.trim())) {
        api.showError({ title: 'That doesn\u2019t look like an Anthropic key', message: 'Anthropic keys start with sk-ant-. Copy it again from your Anthropic account.' });
        return;
      }
      harness.setKey(value);
      keyState.textContent = 'Key loaded for this tab only';
      keyState.classList.add('ok');
      api.hideError();
    };
    useKey.addEventListener('click', applyKey);
    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyKey(); } });
    forget.addEventListener('click', () => {
      harness.clearKey();
      keyState.textContent = 'No key loaded';
      keyState.classList.remove('ok');
    });
    window.addEventListener('pagehide', () => harness && harness.clearKey());
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        keyState.textContent = 'No key loaded';
        keyState.classList.remove('ok');
      }
    });

    const area = (placeholder, label) => h('textarea', { placeholder, 'aria-label': label, spellcheck: 'false' });
    const before = area('Paste the instructions your AI gets before every question.', 'Your AI\u2019s instructions');
    const reference = area('Optional: paste reference pages. Put a line with just --- between pages. The first line of each page is its title.', 'Reference pages');
    const questions = area('Optional: one question per line. These become buttons on The library.', 'Sample questions');

    const status = h('div', { class: 'setup-status' });
    const apply = h('button', { type: 'button', class: 'primary', text: 'Use these and go to Token Cost' });
    apply.addEventListener('click', () => {
      if ([before, reference, questions].some((t) => KEY_SHAPE.test(t.value))) {
        for (const t of [before, reference, questions]) t.value = t.value.replace(new RegExp(KEY_SHAPE.source, 'g'), '');
        api.showError({ title: 'API key found in a text box', message: 'It has been removed. Paste your key only in the API key box at the top.' });
        return;
      }
      user.before = before.value;
      user.reference = reference.value;
      user.questions = questions.value;
      if (!user.before.trim()) {
        api.showError({ title: 'No instructions yet', message: 'Paste your AI\u2019s instructions first.' });
        return;
      }
      api.refresh(buildState());
      const pages = buildState().knowledge.categories.length;
      const n = estimateTokens(user.before);
      const p = pricing.models[api.settings.model];
      status.textContent = (p ? 'Your instructions cost ' + formatUSD((n * p.input) / 1e6) + ' each time they are sent (' + formatTokens(n) + ' tokens)' : 'Instructions loaded') +
        (pages ? ', with ' + pages + ' reference pages.' : '.');
      api.showView('live');
    });

    const field = (label, control, hint, grow, key) =>
      h('div', { class: 'field' + (grow ? ' grow' : '') },
        h('div', { class: 'label-row' }, h('span', { class: 'label', text: label }), key ? api.info(key) : null),
        control, hint ? h('div', { class: 'hint', text: hint }) : null);

    view.append(
      api.head('Set up your own meter', 'Paste your key and your instructions. Nothing is saved, and the key only ever goes to Anthropic.').el,
      h('div', { class: 'setup-grid' },
        h('div', { class: 'setup-col' },
          field('Anthropic API key', h('div', { class: 'key-row' }, keyInput, useKey), 'Kept in this tab\u2019s memory only. Sent only to Anthropic. Never saved.', false, 'apiKey'),
          h('div', { class: 'key-row' }, keyState, forget),
          field('Your AI\u2019s instructions', before, null, true)),
        h('div', { class: 'setup-col' },
          field('Reference pages (optional)', reference, null, true),
          field('Sample questions (optional)', questions, null, true))),
      h('div', { class: 'key-row' }, apply, status));
  }

  TW.app.start(backend);
})();
