// Token Wars UI. One shell for the stage page and the giveaway page; each
// supplies a `backend` object. All dynamic text is set with textContent.
(function () {
  const TW = window.TW;
  const { formatUSD, formatTokens } = TW.cost;
  const LOGO = '/assets/V3_Stacked_TR_RIQ_White.svg';
  const LOGO_LINK = 'https://www.techrecipes.com';
  const PER = 1e6;
  const CONTEXTS = [{ value: 300000, label: '300K' }, { value: 1000000, label: '1M' }];
  const KEY_PROMPT = [
    'Before running the caching check, make sure this project can reach Anthropic\u2019s API on this computer.',
    'First, find out how this project reads its Anthropic API key, usually a setting called ANTHROPIC_API_KEY in a .env file or in the computer\u2019s environment. Check whether it is already set here. Only tell me yes or no. Never show, print, copy or repeat the key itself.',
    'If it is already set, tell me we are ready and stop.',
    'If it is not set:',
    '1. Tell me how to set up a key myself from console.anthropic.com (sign in, then Settings, then API Keys, then Create Key), and to make sure the account has billing or credits set up.',
    '2. Tell me exactly which file to open and what line to add, using a placeholder like ANTHROPIC_API_KEY=paste-your-key-here. I will paste the real key into the file myself. Do not ask me to paste it into this chat.',
    '3. Make sure that file is listed in .gitignore so the key is never committed or shared. If it is not, add it, and show me that one-line change.',
    '4. When I say done, confirm the key is found without revealing it, then tell me we\u2019re ready.',
    'Change nothing else in the project.',
  ].join('\n\n');
  const CHECK_PROMPT = [
    'Run two similar requests to the AI, one right after the other, and tell me in one plain sentence whether caching worked, how much of the instructions came from the saved copy, and how much it saved.',
  ].join('\n\n');
  const FIX_PROMPT = [
    'Caching doesn\u2019t seem to be working, because I\u2019m not saving any money on token cost. Explain in short, plain, numbered points why it isn\u2019t working and how to fix it. Then make the fix, show me what you changed, and wait for my OK before running the check again.',
  ].join('\n\n');
  const SUPPORT_LINK = 'https://calendly.com/techrecipes/tech-recipes-clone';
  const CACHE_PROMPT = [
    'Add Anthropic prompt caching to this project without changing how anything behaves.',
    'Before you change anything, look. Find every place this code calls Claude by searching for messages.create, /v1/messages and the Anthropic SDK, then list each one with its file and line. If there are none, stop and tell me.',
    'Work safely. Make this change on a new git branch, leave every other branch and worktree alone, and do not merge, rebase or push anything.',
    'For each call, find the part of the request that is identical every time, meaning tools, system instructions and fixed reference text. Anything that changes per request, such as dates, names, IDs or the user\u2019s question, must come after it. If moving something would change what the AI actually receives, stop and ask me first.',
    'Then add "cache_control": {"type": "ephemeral"} to the last block that never changes. If system is a plain string, turn it into a list holding one text block first. If the project uses a framework such as LangChain or the Vercel AI SDK, use that framework\u2019s own caching option instead of editing raw requests.',
    'Change nothing else. Same models, same prompt wording, same settings, same dependencies, same formatting.',
    'If the unchanging part is shorter than the model\u2019s minimum, which is 1,024 tokens on Claude Sonnet 5 and 512 on Claude Opus 5.5 and Claude Fable 5.1, tell me instead of padding it.',
    'Run the existing tests and build, and fix only what this change broke.',
    'Then show me how to confirm it works, which is two similar calls within five minutes where the second response reports cache_read_input_tokens above zero.',
    'Finally, show me the full diff and wait for my OK before committing.',
  ].join('\n\n');
  const WATCH_PROMPT = [
    'Help me point this project\u2019s Anthropic calls at a local meter on my own computer, just while I\u2019m testing, without changing what it answers or where it normally sends real traffic.',
    'Before you change anything, look. Find every place this project creates an Anthropic client or calls messages.create or /v1/messages, and list each one with its file and line. If there are none, stop and tell me.',
    'Work safely. Make this change on a new git branch, leave every other branch and worktree alone, and do not merge, rebase or push anything.',
    'Make the API address configurable instead of fixed, for example by reading an environment variable such as ANTHROPIC_BASE_URL before falling back to Anthropic\u2019s own address. Most official Anthropic SDKs already support this; if this project doesn\u2019t use one, add a small override instead of rewriting how requests are built.',
    'Then tell me the one line to add to my local .env, never committed, that would point that variable at the local meter instead of Anthropic\u2019s own address, and how to remove it to go back to normal.',
    'Change nothing else. Same models, same prompt wording, same settings, same dependencies, same formatting.',
    'Run the existing tests and build, and fix only what this change broke.',
    'Then show me the full diff and wait for my OK before committing.',
  ].join('\n\n');
  const EFFORTS = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }];

  // The single line that switches caching on, shown in context.
  const CODE_LINE = '"cache_control": { "type": "ephemeral" }';
  const CODE = [
    '"system": [{',
    '  "type": "text",',
    '  "text": "The part that never changes",',
    '  ' + CODE_LINE,
    '}],',
    '"messages": [',
    '  { "role": "user", "content": "The question" }',
    ']',
  ];

  // Every info-circle explanation on screen. One plain sentence each.
  const HOVERS = {
    model: 'The model is which AI does the work: bigger models are more capable and charge more for every word they read and write.',
    effort: 'How hard the AI thinks before it answers: more effort can give a better answer, and the extra thinking is billed like words it writes.',
    context: 'Context is everything sent along with a question, such as documents, data and earlier messages; the line under the boxes shows what that much would add.',
    inputTok: 'Everything the AI reads fresh for this answer, meaning instructions, data and the question, charged at the full reading price.',
    outputTok: 'Everything the AI writes back, including any thinking it does first; each token it writes costs several times more than one it reads.',
    totalTok: 'What this answer would cost if every token were sent at the full price, with nothing read from cache.',
    cachedTok: 'What this answer actually cost with caching on: the question, the answer, and the instructions read from cache at a fraction of the full price.',
    savings: 'How much less this answer cost than the same answer without caching.',
    runs: 'Every question asked on this page, newest first. TTL is the cost without caching, CTC the cost with caching, and % Savings the difference between them.',
    tokens: 'Tokens are the unit AI companies bill by; one token is roughly three quarters of a word.',
    apiKey: 'A private code from your Anthropic account that lets Token Wars use the AI and bills the cost to you.',
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function renderAnswer(el, text) {
    clear(el);
    let list = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/\*\*|__/g, '').replace(/^#+\s*/, '').trimEnd();
      const bullet = line.match(/^\s*(?:[-*\u2022]|\d+[.)])\s+(.*)$/);
      if (bullet) {
        if (!list) { list = h('ul'); el.append(list); }
        list.append(h('li', { text: bullet[1] }));
      } else {
        list = null;
        if (line.trim()) el.append(h('p', { text: line.trim() }));
      }
    }
  }

  function files(n) { return formatTokens(n) + (n === 1 ? ' file' : ' files'); }

  function compactTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    return formatTokens(n);
  }

  function tokens(n) { return formatTokens(n) + (n === 1 ? ' token' : ' tokens'); }

  function rate(n) { return '$' + Number(n || 0).toFixed(2); }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function niceDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : String(iso || '');
  }

  const HEADS = {
    why: ['Why your AI keeps paying for the same brief', 'Caching keeps your instructions on file, so every question after the first pays a fraction to send them.'],
    prompt: ['Turn on caching in your own project', 'Paste one prompt into your coding tool, or add one line by hand. Nothing else in your build changes.'],
    rules: ['Clean up your instructions before you cache them', 'Messy instructions cost more on every question. Clashing rules are marked red, repeats amber, and the fix green.'],
    answers: ['The same answer, with and without caching', 'One question, asked twice at the same moment. The only difference is whether the instructions come from the cache.'],
    live: ['What does your AI answer really cost?', 'Ask a question and see every part of the bill, from what the AI reads to what it writes back.'],
    scale: ['How we save our clients money and reduce overhead', 'The below represents a case study where we were able to save 97% on token costs when implementing our proprietary intelligence.'],
    shelf: ['What goes along with every question', 'Reference pages sent with a question are paid for every time, whether the answer needs them or not.'],
    watch: ['Watch it happen in your own project', 'Point your own project at the meter below, just while you\u2019re testing, and see real calls cost out live, without changing what it answers.'],
  };

  const BASE_VIEWS = [
    { id: 'why', label: 'WTF is Cache?' },
    { id: 'prompt', label: 'How to Cache' },
    { id: 'rules', label: 'Cache Cleanup' },
    { id: 'answers', label: 'Before & After' },
    { id: 'live', label: 'Token Cost' },
    { id: 'shelf', label: 'The library' },
  ];

  function start(backend) {
    const app = {
      backend,
      state: null,
      settings: { model: '', effort: 'low', caching: false, promptVersion: 'before', contextMode: 'full' },
      view: 'why',
      context: CONTEXTS[0].value,
      tool: null,
      busy: false,
      lastAsk: null,
      runs: [],
      shelfQuestion: null,
      els: {},
    };
    // The stage build swaps its last tab for "At Scale" (when the case-study data is
    // present) followed by "Watch my app"; the giveaway build keeps the older
    // library tab, which does real work there against the attendee's own pages.
    const views = (backend.extraViews || []).concat(BASE_VIEWS.filter((v) => v.id !== 'rules' || backend.rulesCompare !== false)
      .flatMap((v) => {
        if (v.id !== 'shelf' || !backend.watch) return [v];
        return [...(backend.atScale ? [{ id: 'scale', label: 'At Scale' }] : []), { id: 'watch', label: 'Watch my app' }];
      }));
    if (backend.getStarted) views.unshift({ id: 'start', label: 'Get Started' });
    const E = app.els;

    // ---------- info hovers ----------
    E.tip = h('div', { class: 'tip hidden', role: 'tooltip', id: 'tw-tip' });
    let tipFor = null;
    function hoverText(key) { return (app.state && app.state.hovers && app.state.hovers[key]) || HOVERS[key]; }
    // The title and one line of subtext that opens every view; extra goes on the right.
    function head(title, sub, extra) {
      const t = h('h1', { class: 'sec-title', text: title });
      const d = h('div', { class: 'sec-sub', text: sub });
      const help = h('div', { class: 'get-help' }, h('span', { text: 'If you\u2019re stuck' }),
        h('a', { class: 'get-help-btn', href: SUPPORT_LINK, target: '_blank', rel: 'noopener noreferrer', text: 'Get Help' }));
      return { el: h('div', { class: 'sec-head' }, h('div', { class: 'sec-text' }, t, d), h('div', { class: 'sec-side' }, extra || null, help)), title: t, sub: d };
    }
    function info(key) {
      return h('button', {
        type: 'button', class: 'info', 'data-tip-key': key, 'aria-label': 'What this means', 'aria-describedby': 'tw-tip',
        onmouseenter: (e) => showTip(e.currentTarget),
        onmouseleave: hideTip,
        onfocus: (e) => showTip(e.currentTarget),
        onblur: hideTip,
        onclick: (e) => { e.stopPropagation(); if (tipFor === e.currentTarget) hideTip(); else showTip(e.currentTarget); },
      }, 'i');
    }
    function showTip(btn) {
      tipFor = btn;
      E.tip.textContent = hoverText(btn.dataset.tipKey);
      E.tip.classList.remove('hidden');
      const r = btn.getBoundingClientRect();
      const tw = E.tip.offsetWidth;
      const th = E.tip.offsetHeight;
      const left = Math.max(16, Math.min(innerWidth - tw - 16, r.left + r.width / 2 - tw / 2));
      let top = r.bottom + 12;
      if (top + th > innerHeight - 16) top = Math.max(16, r.top - th - 12);
      E.tip.style.left = left + 'px';
      E.tip.style.top = top + 'px';
    }
    function hideTip() { tipFor = null; E.tip.classList.add('hidden'); }
    document.addEventListener('click', () => { if (tipFor) hideTip(); });
    const labelRow = (text, key) => h('div', { class: 'label-row' }, h('span', { class: 'label', text }), key ? info(key) : null);

    // ---------- skeleton ----------
    const select = (name, label, onchange) => {
      const el = h('select', { 'aria-label': label, 'data-setting': name, onchange: onchange || ((e) => changeSetting(name, e.target.value)) });
      return { el, wrap: h('div', { class: 'select-wrap' }, el) };
    };

    E.selModel = select('model', 'AI model');
    E.selEffort = select('effort', 'Effort');
    for (const o of EFFORTS) E.selEffort.el.append(h('option', { value: o.value, text: o.label }));
    E.selContext = select('context', 'Context', (e) => { app.context = Number(e.target.value); renderContext(); });
    for (const o of CONTEXTS) E.selContext.el.append(h('option', { value: o.value, text: o.label }));
    E.status = h('div', { class: 'ask-status', 'aria-live': 'polite' });
    E.brandTitle = h('div', { class: 'brand-title' });

    E.tabs = h('nav', { class: 'tabs', role: 'tablist', 'aria-orientation': 'vertical' });
    for (const v of views) {
      E.tabs.append(h('button', {
        type: 'button', role: 'tab', 'data-view': v.id, 'aria-selected': 'false',
        text: v.label, onclick: () => showView(v.id),
      }));
    }
    E.sideToggle = h('button', { type: 'button', class: 'side-toggle', 'aria-label': 'Hide menu', 'aria-expanded': 'true', onclick: toggleSide }, '\u00ab');

    const side = h('aside', { class: 'side' },
      h('div', { class: 'side-head' },
        h('a', { class: 'logo-link', href: LOGO_LINK, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Tech Recipes (opens www.techrecipes.com)' },
          h('img', { class: 'logo', src: LOGO, alt: '', width: 90, height: 67, decoding: 'async' })),
        E.sideToggle),
      h('div', { class: 'brand' }, E.brandTitle),
      E.tabs);

    E.bannerTitle = h('div', { class: 'banner-title' });
    E.bannerMsg = h('div', { class: 'banner-msg' });
    E.banner = h('div', { class: 'banner hidden', role: 'alert' },
      h('div', {}, E.bannerTitle, E.bannerMsg),
      h('button', { type: 'button', text: 'OK', onclick: hideError }));

    const main = h('main', { class: 'main' }, E.banner);
    E.views = {};
    for (const v of views) {
      const section = h('section', { class: 'view hidden', 'data-view': v.id, role: 'tabpanel' });
      E.views[v.id] = section;
      main.append(section);
    }

    E.app = h('div', { class: 'app' }, side, main);
    document.body.append(E.app, E.tip);

    buildLive(E.views.live);
    buildPrompt(E.views.prompt);
    buildAnswers(E.views.answers);
    if (E.views.rules) buildRules(E.views.rules);
    buildWhy(E.views.why);
    if (E.views.shelf) buildShelf(E.views.shelf);
    if (E.views.scale) buildScale(E.views.scale);
    if (E.views.watch) buildWatch(E.views.watch);
    if (E.views.start) buildStart(E.views.start);

    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if ((t && t.closest && t.closest('input, textarea, select')) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= views.length) { showView(views[n - 1].id); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'm' || e.key === 'M') toggleSide();
      else if (e.key === 'Escape') { hideError(); hideTip(); }
    });

    // ---------- public API for backends/extra views ----------
    const api = {
      h, clear, info, head, showError, hideError, showView, refresh, setStatus,
      get state() { return app.state; },
      get settings() { return app.settings; },
      applySession,
    };
    for (const v of backend.extraViews || []) v.build(E.views[v.id], api);

    // ---------- helpers ----------
    function pickerList() { return (app.state && app.state.prices && app.state.prices.picker) || []; }
    function priceOf(model) { return pickerList().find((p) => p.model === model) || null; }
    function currentPrice() { return priceOf(app.settings.model) || pickerList()[0] || null; }
    function sendCost(tokenCount, price) { return price ? (tokenCount * price.input) / PER : 0; }

    // ---------- behaviour ----------
    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    }

    function toggleSide() {
      const min = !E.app.classList.contains('side-min');
      E.app.classList.toggle('side-min', min);
      E.sideToggle.textContent = min ? '\u00bb' : '\u00ab';
      E.sideToggle.setAttribute('aria-label', min ? 'Show menu' : 'Hide menu');
      E.sideToggle.setAttribute('aria-expanded', String(!min));
      hideTip();
    }

    function showView(id) {
      app.view = id;
      hideTip();
      for (const b of E.tabs.children) b.setAttribute('aria-selected', String(b.dataset.view === id));
      for (const [vid, el] of Object.entries(E.views)) el.classList.toggle('hidden', vid !== id);
      if (['live', 'answers'].includes(id) && E.askBox.parentNode !== E.views[id]) E.views[id].querySelector(':scope > .sec-head').after(E.askBox);
      if (id === 'rules') scrollRules();
      if (id === 'why') renderWhy();
      if (id === 'shelf') renderShelf();
      if (id === 'scale') renderScale();
    }

    function showError(err) {
      err = err || {};
      E.bannerTitle.textContent = err.title || 'Something went wrong';
      E.bannerMsg.textContent = err.message || 'That did not work. Try again.';
      E.banner.classList.remove('hidden');
    }
    function hideError() { E.banner.classList.add('hidden'); }
    function setStatus(text) { E.status.textContent = text || ''; }

    function setBusy(on) {
      app.busy = on;
      E.app.classList.toggle('busy', on);
      document.querySelectorAll('[data-ask]').forEach((b) => { b.disabled = on; });
    }

    function applySession(session) {
      if (!session) return;
      app.session = session;
    }

    function renderModelSelect() {
      clear(E.selModel.el);
      for (const p of pickerList()) E.selModel.el.append(h('option', { value: p.model, text: p.label || p.model }));
    }

    function renderToggles() {
      E.selModel.el.value = app.settings.model;
      E.selEffort.el.value = app.settings.effort;
      E.selContext.el.value = String(app.context);
    }

    function renderPriceText() {
      const p = (app.lastAsk && priceOf(app.lastAsk.model)) || currentPrice();
      const when = app.state && app.state.prices && app.state.prices.verifiedOn;
      renderContext();
      if (!p) { E.rates.textContent = ''; return; }
      E.rates.textContent = p.label + ' charges per million tokens: ' + rate(p.input) + ' input \u00b7 ' +
        rate(p.output) + ' output \u00b7 ' + rate(p.cacheWrite5m) + ' to cache \u00b7 ' + rate(p.cacheRead) + ' from cache' +
        (when ? '. Checked ' + niceDate(when) + '.' : '.');
    }

    async function changeSetting(name, value) {
      if (name === 'caching') value = value === true || value === 'true';
      if (app.settings[name] === value) return;
      app.settings = { ...app.settings, [name]: value };
      renderToggles();
      renderShelf();
      renderPriceText();
      renderReuse();
      renderWhy();
      if (app.settings.caching && app.state && app.state.prewarm !== false) {
        setStatus('Caching the instructions\u2026');
        const r = await backend.warm(app.settings).catch(() => ({ ok: false, error: TW.errors.friendly('unknown') }));
        if (r.ok && r.call) {
          setStatus(r.call.cacheState === 'short'
            ? 'These instructions are too short for this AI to cache.'
            : 'Ready. The next question uses the cached instructions.');
        } else if (r.ok) {
          setStatus('');
        } else {
          setStatus('');
          showError(r.error);
        }
        applySession(r.session);
      } else {
        setStatus('');
      }
    }

    async function resetAll() {
      const r = await backend.reset();
      app.lastAsk = null;
      app.runs = [];
      renderPriceText();
      resetLiveResult();
      renderRuns();
      applySession(r.session);
      setStatus('');
    }

    // ---------- One answer ----------
    function buildLive(v) {
      E.liveInput = h('input', { type: 'text', placeholder: 'Type a question and press Ask', 'aria-label': 'Question', autocomplete: 'off', spellcheck: 'false' });
      const form = E.askBox = h('form', { class: 'ask-box panel', onsubmit: (e) => {
        e.preventDefault();
        if (app.view === 'answers') compare(E.liveInput.value); else ask(E.liveInput.value);
      } },
        h('div', { class: 'label-row' }, h('span', { class: 'label', text: 'Question' }), E.status),
        h('div', { class: 'ask-input' }, E.liveInput, h('button', { class: 'primary', type: 'submit', 'data-ask': true, text: 'Ask' })),
        h('div', { class: 'ask-row' },
          h('div', { class: 'pick' }, labelRow('AI model', 'model'), E.selModel.wrap),
          h('div', { class: 'pick' }, labelRow('Effort', 'effort'), E.selEffort.wrap),
          h('div', { class: 'pick' }, labelRow('Context', 'context'), E.selContext.wrap)));
      E.liveQ = h('div', { class: 'question-line' });
      const card = (cls, label, key) => {
        const cost = h('div', { class: 'card-cost', text: formatUSD(0) });
        const tok = h('div', { class: 'card-tokens', text: tokens(0) });
        return { el: h('div', { class: 'card ' + cls }, labelRow(label, key), cost, tok), tokens: tok, cost };
      };
      E.cards = {
        input: card('c-input', 'Input Tokens', 'inputTok'),
        output: card('c-output', 'Output Tokens', 'outputTok'),
        total: card('c-total', 'Cost without caching', 'totalTok'),
        cached: card('c-cached', 'Cost with caching', 'cachedTok'),
        savings: card('c-savings', 'Percent Savings', 'savings'),
      };
      E.cacheNote = h('div', { class: 'cache-note' });
      E.ctxNote = h('div', { class: 'ctx-note' });
      E.rates = h('div', { class: 'rates' });
      E.liveAnswer = h('div', { class: 'answer scroll' });
      E.runs = h('div', { class: 'runs scroll' });
      E.runsTotal = h('div', { class: 'run-row run-total' });

      const top = head(HEADS.live[0], HEADS.live[1]);
      E.pageTitle = top.title;
      v.append(
        top.el,
        form,
        h('div', { class: 'cards' }, Object.values(E.cards).map((c) => c.el)),
        h('div', { class: 'under-cards' }, E.ctxNote, E.cacheNote, h('div', { class: 'rates-row' }, E.rates, info('tokens'))),
        h('div', { class: 'live-bottom' },
          h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'The answer' }), E.liveQ, E.liveAnswer),
          h('div', { class: 'panel' },
            h('div', { class: 'run-row run-head' },
              h('div', { class: 'label-row' }, h('span', { class: 'panel-title', text: 'LLM comparison' }), info('runs')),
              h('span', { text: 'TTL' }), h('span', { text: 'CTC' }), h('span', { text: '% Savings' })),
            E.runs, E.runsTotal))
      );
      resetLiveResult();
      renderRuns();
    }

    function resetLiveResult() {
      for (const c of Object.values(E.cards)) { c.tokens.textContent = tokens(0); c.cost.textContent = formatUSD(0); }
      E.cards.savings.cost.textContent = '\u2014';
      E.cards.savings.tokens.textContent = '';
      E.cards.savings.el.classList.remove('good', 'bad');
      E.cacheNote.textContent = '';
      E.liveQ.textContent = '';
      clear(E.liveAnswer).append(h('div', { class: 'placeholder-text', text: 'Ask a question above to see what one answer costs.' }));
    }

    function questionChips(container, onPick) {
      clear(container);
      for (const q of (app.state && app.state.questions) || []) {
        container.append(h('button', { type: 'button', class: 'chip', 'data-ask': true, 'data-qid': q.id, text: q.short || q.text, onclick: () => onPick(q) }));
      }
    }

    function markChip(container, id) {
      for (const c of container.children) c.classList.toggle('active', c.dataset.qid === id);
    }

    function presetFor(text) {
      return ((app.state && app.state.questions) || []).find((x) => x.text === text) || null;
    }

    // Returns the trimmed question, or null after showing why it cannot be sent.
    function checkQuestion(text) {
      text = String(text || '').trim();
      if (app.busy) return null;
      if (!text) { showError(TW.errors.friendly('input')); return null; }
      if (/sk-ant-[A-Za-z0-9_\-]{6,}/.test(text)) {
        E.liveInput.value = '';
        showError({ title: 'That looks like an API key', message: 'It was not sent. Type a question instead.' });
        return null;
      }
      return text;
    }

    async function ask(raw) {
      const text = checkQuestion(raw);
      if (!text) return;
      const q = presetFor(text);
      hideError();
      setBusy(true);
      app.shelfQuestion = { text, id: q && q.id };
      E.liveQ.textContent = '';
      E.liveQ.append('Q: ', h('strong', { text }));
      clear(E.liveAnswer).append(h('div', { class: 'placeholder-text' }, h('span', { class: 'spinner' }), 'Asking the AI\u2026'));
      try {
        const r = await backend.ask({ question: text, questionId: q && q.id, settings: app.settings });
        if (!r.ok) {
          showError(r.error);
          clear(E.liveAnswer).append(h('div', { class: 'placeholder-text', text: 'No answer. See the message above.' }));
        } else {
          showCall(r.call);
          addRun(text, r.call);
          if (r.relevant) app.shelfRelevant = r.relevant;
        }
        applySession(r.session);
      } catch {
        showError(TW.errors.friendly('network'));
        clear(E.liveAnswer);
      } finally {
        setBusy(false);
      }
    }

    function showCall(call) {
      app.lastAsk = call;
      renderPriceText();
      const u = call.usage;
      const c = call.cost;
      const set = (k, n, dollars) => { E.cards[k].tokens.textContent = tokens(n); E.cards[k].cost.textContent = formatUSD(dollars); };
      set('input', u.input, c.input);
      set('output', u.output, c.output);
      const all = u.input + u.cacheWrite + u.cacheRead + u.output;
      const base = c.totalUncached || c.total;
      set('total', all, base);
      set('cached', all, c.total);
      if (u.cacheRead && u.cacheWrite) E.cards.cached.tokens.textContent = formatTokens(u.cacheRead) + ' from cache \u00b7 ' + formatTokens(u.cacheWrite) + ' cached';
      else if (u.cacheRead) E.cards.cached.tokens.textContent = tokens(u.cacheRead) + ' from cache';
      else if (u.cacheWrite) E.cards.cached.tokens.textContent = tokens(u.cacheWrite) + ' cached';
      const pct = base > 0 ? Math.round(((base - c.total) / base) * 100) : 0;
      E.cards.savings.cost.textContent = (pct < 0 ? '\u2212' : '') + Math.abs(pct) + '%';
      E.cards.savings.tokens.textContent = pct > 0 ? formatUSD(base - c.total) + ' saved by caching'
        : pct < 0 ? 'extra, to cache the instructions' : call.settings && call.settings.caching ? 'nothing cached this time' : 'caching is off';
      E.cards.savings.el.classList.toggle('good', pct > 0);
      E.cards.savings.el.classList.toggle('bad', pct < 0);
      E.cacheNote.textContent = (call.cacheNote || '').trim();
      E.cacheNote.classList.toggle('warn', call.cacheState === 'short');
      renderAnswer(E.liveAnswer, call.answer);
      E.liveAnswer.scrollTop = 0;
    }

    // What the chosen amount of context would add. The real question stays small; this line is arithmetic on list prices.
    function renderContext() {
      if (!E.ctxNote) return;
      const n = app.context;
      const size = (CONTEXTS.find((c) => c.value === n) || { label: formatTokens(n) }).label;
      if (E.cmpCtx) {
        clear(E.cmpCtx);
        const lc = app.lastCompare;
        const pc = lc && priceOf(lc.on.model);
        if (pc) {
          E.cmpCtx.append('With ' + size + ' tokens of context: ', h('strong', { text: formatUSD(lc.off.cost.total + (n * pc.input) / PER) }),
            ' without caching, ', h('strong', { text: formatUSD(lc.on.cost.total + (n * pc.cacheRead) / PER) }), ' with caching.');
        }
      }
      const p = (app.lastAsk && priceOf(app.lastAsk.model)) || currentPrice();
      if (!p) { E.ctxNote.textContent = ''; return; }
      const fresh = (n * p.input) / PER;
      const reused = (n * p.cacheRead) / PER;
      clear(E.ctxNote);
      if (app.lastAsk) {
        const c = app.lastAsk.cost;
        E.ctxNote.append('With ' + size + ' tokens of context, this answer would cost ', h('strong', { text: formatUSD((c.totalUncached || c.total) + fresh) }),
          ' without caching, or ', h('strong', { text: formatUSD(c.total + reused) }), ' with caching.');
      } else {
        E.ctxNote.append(size + ' tokens of context adds ', h('strong', { text: formatUSD(fresh) }), ' to every question on ' + p.label +
          ' without caching, or ', h('strong', { text: formatUSD(reused) }), ' with caching.');
      }
    }

    function addRun(text, call) {
      const c = call.cost;
      const label = (list, v) => (list.find((o) => o.value === v) || { label: String(v) }).label;
      app.runs.unshift({
        text,
        settings: [((priceOf(call.model) || {}).label || call.model).replace(/^Claude /, ''), label(EFFORTS, app.settings.effort), label(CONTEXTS, app.context)].join(' \u2013 '),
        total: c.total,
        uncached: c.totalUncached || c.total,
      });
      renderRuns();
    }

    const pctOf = (total, uncached) => (uncached > 0 ? Math.round(((uncached - total) / uncached) * 100) : 0);
    const pctText = (p) => (p < 0 ? '\u2212' : '') + Math.abs(p) + '%';

    function renderRuns() {
      clear(E.runs);
      clear(E.runsTotal);
      if (!app.runs.length) { E.runs.append(h('div', { class: 'placeholder-text', text: 'Each question you ask here is added to this list.' })); return; }
      for (const r of app.runs) {
        const p = pctOf(r.total, r.uncached);
        E.runs.append(h('div', { class: 'run-row' },
          h('div', { class: 'run-q' }, h('div', { class: 'run-text', text: r.text }), h('div', { class: 'run-set', text: r.settings })),
          h('span', { class: 'run-v', text: formatUSD(r.uncached) }), h('span', { class: 'run-v', text: formatUSD(r.total) }),
          h('span', { class: 'run-v' + (p > 0 ? ' good' : ''), text: pctText(p) })));
      }
      const sum = (k) => app.runs.reduce((a, r) => a + r[k], 0);
      const p = pctOf(sum('total'), sum('uncached'));
      E.runsTotal.append(h('div', { class: 'run-text', text: 'All ' + app.runs.length + (app.runs.length === 1 ? ' question' : ' questions') }),
        h('span', { class: 'run-v', text: formatUSD(sum('uncached')) }), h('span', { class: 'run-v', text: formatUSD(sum('total')) }),
        h('span', { class: 'run-v' + (p > 0 ? ' good' : ''), text: pctText(p) }));
    }

    // ---------- How to Cache ----------
    function buildPrompt(v) {
      v.append(head(HEADS.prompt[0], HEADS.prompt[1]).el);
      const code = h('pre', { class: 'code' },
        CODE.map((ln) => h('div', { class: ln.includes('cache_control') ? 'code-line hl' : 'code-line', text: ln })));
      const copyLine = h('button', { type: 'button', class: 'copy-btn', text: 'Copy the line' });
      copyLine.addEventListener('click', () => copyText(CODE_LINE, copyLine));
      const copyPrompt = h('button', { type: 'button', class: 'primary copy-btn', text: 'Copy the prompt' });
      copyPrompt.addEventListener('click', () => copyText(CACHE_PROMPT, copyPrompt));
      E.howSteps = h('ol', { class: 'how-steps scroll' });
      v.append(h('div', { class: 'reuse' },
        h('div', { class: 'panel reuse-prompt' },
          h('div', { class: 'reuse-title', text: 'Add it to your own project' }),
          h('p', { class: 'reuse-sub', text: 'Paste the prompt below into your preferred coding agent (Cursor, Codex, Claude Code, etc.) and press Enter.' }),
          h('div', { class: 'prompt-text scroll', text: CACHE_PROMPT }),
          copyPrompt),
        h('div', { class: 'reuse-side' },
          h('div', { class: 'panel' },
            h('div', { class: 'reuse-title', text: 'The one line that switches caching on' }),
            code,
            h('div', { class: 'reuse-caption' }, copyLine,
              h('span', { text: 'Add it to the block that never changes. Everything up to that line is saved; the question after it is sent fresh.' }))),
          h('div', { class: 'panel how-panel' },
            h('div', { class: 'reuse-title', text: 'After you paste the prompt into your coding tool' }),
            E.howSteps))));
    }

    function renderReuse() {
      if (!E.howSteps) return;
      const step = (title, ...body) => h('li', {}, h('strong', { text: title + ' ' }), ...body);
      const box = (text) => {
        const btn = h('button', { type: 'button', class: 'copy-btn', text: 'Copy' });
        btn.addEventListener('click', () => copyText(text, btn));
        return h('div', { class: 'step-prompt' }, h('div', { class: 'prompt-text', text }), btn);
      };
      const p = (...kids) => h('p', {}, ...kids);
      clear(E.howSteps).append(
        step('Answer any questions.', 'The coding tool may stop and ask you something before it changes anything. Answer the questions to the best of your ability.'),
        step('Review and approve the changes.', 'When it\u2019s done, the tool shows you a list of everything it changed and waits for your go-ahead. Nothing is final until you type \u201cOK\u201d and hit Enter. If something looks wrong or unexpected, say so and ask it to explain in natural language.'),
        step('Make sure you have Anthropic\u2019s API connected.', 'Copy and paste the prompt into the coding agent and press Enter.', box(KEY_PROMPT)),
        step('Check that it\u2019s saving money.', p(h('strong', { text: 'Type this into your coding tool:' })), box(CHECK_PROMPT),
          p(h('strong', { text: 'You\u2019ll get a one-sentence answer.' }), ' If it says caching worked, you\u2019re done.'),
          p(h('strong', { text: 'If it says nothing came from the saved copy, reply:' })), box(FIX_PROMPT)),
        step('Optional: watch it live.', 'If you have this Token Wars folder on your computer, run ',
          h('code', { class: 'inline-code', text: 'npm run watch' }), ' in it, then, just while you\u2019re testing, point your project\u2019s Anthropic connection at the address it prints instead of Anthropic\u2019s own. A page opens showing every real call your project makes and what each one costs, so you can watch the savings happen instead of asking your coding tool to check.'),
        step('If you\u2019re stuck.', h('a', { class: 'how-link', href: SUPPORT_LINK, target: '_blank', rel: 'noopener noreferrer', text: 'Click here' }),
          ' to schedule a free 30-minute support session with Brian Chap.'));
    }

    async function copyText(text, btn) {
      const label = btn.textContent;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back below */ }
      if (!ok) {
        const ta = h('textarea', { class: 'offscreen', 'aria-hidden': 'true' });
        ta.value = text;
        document.body.append(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
      }
      btn.textContent = ok ? 'Copied' : 'Select the text and copy it';
      setTimeout(() => { btn.textContent = label; }, 2000);
    }

    // ---------- Before and after ----------
    function buildAnswers(v) {
      v.append(head(HEADS.answers[0], HEADS.answers[1]).el);
      const col = (key, label) => {
        const cost = h('div', { class: 'cmp-cost', text: '\u2014' });
        const split = h('div', { class: 'cmp-split' });
        const tok = h('div', { class: 'cmp-tokens' });
        const answer = h('div', { class: 'answer scroll' });
        const title = h('div', { class: 'col-title', text: label });
        const panel = h('div', { class: 'panel cmp-col is-' + key }, title, cost, split, tok, answer);
        return { panel, cost, split, tokens: tok, answer, title };
      };
      E.cOff = col('off', 'Without caching');
      E.cOn = col('on', 'With caching');
      E.cmpSummary = h('div', { class: 'cmp-summary' });
      E.cmpCtx = h('div', { class: 'ctx-note' });
      E.cmpNote = h('div', { class: 'cmp-note', text: 'Same question, same rules, same AI. The only difference is whether the instructions are cached.' });
      v.append(h('div', { class: 'two-col' }, E.cOff.panel, E.cOn.panel), E.cmpSummary, E.cmpCtx, E.cmpNote);
      resetCompare();
    }

    function resetCompare() {
      app.lastCompare = null;
      for (const c of [E.cOff, E.cOn]) {
        c.cost.textContent = '\u2014';
        c.split.textContent = '';
        c.tokens.textContent = '';
        clear(c.answer).append(h('div', { class: 'placeholder-text', text: 'Press Ask to answer the question both ways.' }));
      }
      E.cmpSummary.textContent = '';
      clear(E.cmpCtx);
    }

    async function compare(raw) {
      const text = checkQuestion(raw);
      if (!text) return;
      const q = presetFor(text);
      hideError();
      setBusy(true);
      app.shelfQuestion = { text, id: q && q.id };
      resetCompare();
      for (const c of [E.cOff, E.cOn]) clear(c.answer).append(h('div', { class: 'placeholder-text' }, h('span', { class: 'spinner' }), 'Asking the AI\u2026'));
      try {
        const r = await backend.compare({ question: text, questionId: q && q.id, settings: app.settings });
        if (!r.ok) {
          showError(r.error);
          for (const c of [E.cOff, E.cOn]) clear(c.answer);
        } else {
          fillColumns(r, [['off', E.cOff], ['on', E.cOn]]);
          if (r.off && r.off.ok && r.on && r.on.ok) {
            app.lastCompare = { off: r.off.call, on: r.on.call };
            const b = r.off.call.cost.total;
            const a = r.on.call.cost.total;
            const pct = b > 0 ? Math.round(((b - a) / b) * 100) : 0;
            E.cmpSummary.textContent = pct > 0 ? 'With caching, this answer costs ' + pct + '% less.'
              : r.on.call.cacheState === 'short' ? 'Both cost about the same: these instructions are too short to cache on ' + (r.on.call.modelLabel || r.on.call.model) + '.'
                : 'Both cost about the same.';
            renderContext();
          }
        }
        applySession(r.session);
      } catch {
        showError(TW.errors.friendly('network'));
      } finally {
        setBusy(false);
      }
    }

    function fillColumns(r, cols) {
      let shownError = false;
      for (const [key, c] of cols) {
        const res = r[key];
        if (res && res.ok) {
          const u = res.call.usage;
          const cc = res.call.cost;
          c.cost.textContent = formatUSD(cc.total);
          c.split.textContent = formatUSD(cc.inputSide) + ' to send the instructions \u00b7 ' + formatUSD(cc.output) + ' for the answer';
          c.tokens.textContent = tokens(u.input + u.cacheWrite + u.cacheRead) + ' sent' +
            (u.cacheRead ? ', ' + formatTokens(u.cacheRead) + ' of them from cache' : '') + ' \u00b7 ' + tokens(u.output) + ' back';
          renderAnswer(c.answer, res.call.answer);
        } else {
          clear(c.answer).append(h('div', { class: 'placeholder-text', text: 'No answer.' }));
          if (!shownError) { showError(res && res.error); shownError = true; }
        }
      }
    }

    // ---------- Cache Cleanup ----------
    function buildRules(v) {
      v.append(head(HEADS.rules[0], HEADS.rules[1]).el);
      const col = (key, label) => {
        const stats = h('div', { class: 'col-stats' });
        const lines = h('div', { class: 'lines scroll' });
        const panel = h('div', { class: 'panel cmp-col rules-col is-' + (key === 'before' ? 'off' : 'on') },
          h('div', { class: 'col-title', text: label }), stats, lines);
        return { key, panel, stats, lines };
      };
      E.rBefore = col('before', 'Without caching');
      E.rAfter = col('after', 'With caching');
      E.rulesLegend = h('div', { class: 'legend' },
        h('span', {}, h('span', { class: 'swatch red' }), 'Rules that clash'),
        h('span', {}, h('span', { class: 'swatch amber' }), 'Same rule repeated'),
        h('span', {}, h('span', { class: 'swatch green' }), 'Said once, clearly'));
      v.append(h('div', { class: 'two-col' }, E.rBefore.panel, E.rAfter.panel), h('div', { class: 'rules-foot' }, E.rulesLegend));
    }

    function renderRules() {
      const st = app.state;
      if (!st || !E.rBefore) return;
      for (const col of [E.rBefore, E.rAfter]) {
        const text = (st.prompts && st.prompts[col.key]) || '';
        const conf = (st.conflicts && st.conflicts[col.key]) || {};
        const red = new Set(conf.red || []);
        const amber = new Set(conf.amber || []);
        const green = new Set(conf.green || []);
        const lines = text.replace(/\s+$/, '').split(/\r?\n/);
        const n = TW.cost.estimateTokens(text);
        const bits = [];
        if (text.trim()) {
          bits.push(lines.length + ' lines', tokens(n));
          if (red.size) bits.push(red.size + ' clashes');
          if (amber.size) bits.push(amber.size + ' repeats');
        }
        col.stats.textContent = bits.join(' \u00b7 ');
        clear(col.lines);
        if (!text.trim()) {
          col.lines.append(h('div', { class: 'placeholder-text', text: 'No instructions yet.' }));
          continue;
        }
        lines.forEach((ln, i) => {
          const num = i + 1;
          const cls = ['line'];
          if (red.has(num)) cls.push('line--conflict');
          else if (amber.has(num)) cls.push('line--repeat');
          else if (green.has(num)) cls.push('line--resolved');
          if (/^#/.test(ln)) cls.push('is-heading');
          col.lines.append(h('div', { class: cls.join(' '), 'data-line': num },
            h('span', { class: 'line-no', text: num }),
            h('span', { class: 'line-text', text: ln.replace(/^#+\s*/, '') })));
        });
      }
      scrollRules();
    }

    // Opens each column two lines above its first clash (or first highlight), so the colours are on screen without scrolling.
    function scrollRules() {
      if (app.view !== 'rules' || !E.rBefore) return;
      for (const col of [E.rBefore, E.rAfter]) {
        let top = col.lines.querySelector('.line--conflict') || col.lines.querySelector('.line--repeat, .line--resolved');
        if (!top) { col.lines.scrollTop = 0; continue; }
        for (let i = 0; i < 2 && top.previousElementSibling; i++) top = top.previousElementSibling;
        col.lines.scrollTop = Math.max(0, top.getBoundingClientRect().top - col.lines.getBoundingClientRect().top + col.lines.scrollTop);
      }
    }

    // ---------- Why Cache ----------
    const EXAMPLE_BRIEF = 5000;
    function buildWhy(v) {
      v.append(head(HEADS.why[0], HEADS.why[1]).el);
      const tile = (title) => {
        const body = h('div', { class: 'why-body' });
        return { el: h('div', { class: 'panel why-tile' }, h('div', { class: 'why-title', text: title }), body), body };
      };
      E.whyWhat = tile('What is Cache?');
      E.whyWhy = tile('Why is Cache Important?');
      E.whyBest = tile('Caching Best Practices');
      E.whyLanes = h('div', { class: 'why-lanes' });
      E.whyFoot = h('div', { class: 'why-foot' });
      const key = (cls, text) => h('span', { class: 'why-key' }, h('span', { class: 'seg-blk ' + cls }), text);
      v.append(
        h('div', { class: 'why-tiles' }, E.whyWhat.el, E.whyWhy.el, E.whyBest.el),
        h('div', { class: 'panel why-visual' },
          h('div', { class: 'why-head' },
            h('div', { class: 'why-title', text: 'How caching works, in one picture' }),
            h('div', { class: 'why-legend' },
              key('full', 'Brief read at full price'),
              key('save', 'Brief read and kept on file'),
              key('file', 'Brief taken from file'),
              key('ask', 'The new question'))),
          E.whyLanes, E.whyFoot));
    }

    function briefTokens() {
      const st = app.state || {};
      const prompts = st.prompts || {};
      const prompt = app.settings.promptVersion === 'after' && prompts.after && prompts.after.trim() ? prompts.after : prompts.before || '';
      const cats = (st.knowledge && st.knowledge.categories) || [];
      const lib = cats.reduce((n, c) => n + (c.sentTokens != null ? c.sentTokens : c.tokenCount || 0), 0);
      return TW.cost.estimateTokens(prompt) + (st.dataTokens || 0) + lib;
    }

    function pct(n) { return (Math.round(n * 10) / 10).toString().replace(/\.0$/, '') + '%'; }

    function renderWhy() {
      if (!E.whyLanes || !app.state) return;
      const p = currentPrice();
      if (!p) return;
      const real = briefTokens();
      const brief = real || EXAMPLE_BRIEF;
      const ask = 30;
      const minWords = formatTokens(Math.round((((p.minCacheableTokens) || 1024) * 0.75) / 100) * 100);
      const short = brief < (p.minCacheableTokens || 1024);
      const share = pct((p.cacheRead / p.input) * 100);
      const off = pct(100 - (p.cacheRead / p.input) * 100);
      const perQ = { full: (brief * p.input) / PER, save: (brief * p.cacheWrite5m) / PER, file: (brief * p.cacheRead) / PER, ask: (ask * p.input) / PER };
      const month = (app.state.projection && app.state.projection.questionsPerMonth) || 50000;

      clear(E.whyWhat.body).append(h('p', {},
        'Cache is the AI\u2019s short-term memory for your brief: the instructions, brand rules and campaign data that go with every question. ' +
        'The first time you send the brief, the AI reads it and keeps a copy on file. For the next few minutes, any question that starts with that same brief ' +
        'is answered from the copy, and you pay ' + share + ' of the normal price for that part on ' + p.label + '.'));
      clear(E.whyWhy.body).append(h('p', {},
        'Almost everything you send the AI is the same every time; only the question changes. Without caching you pay full price to resend the whole brief ' +
        'with every question, like re-briefing your agency before every single buy. With caching the brief costs ' + off + ' less from the second question on, ' +
        'and answers start sooner. Across ' + formatTokens(month) + ' questions a month, the brief alone costs ',
        h('strong', { text: formatUSD(perQ.full * month) }),
        ...(short
          ? [' either way: this brief is too short to keep on file until it reaches about ' + minWords + ' words.']
          : [' without caching and ', h('strong', { text: formatUSD(perQ.file * month) }), ' with it.'])));
      const tip = (title, text) => h('li', {}, h('strong', { text: title + ' ' }), text);
      clear(E.whyBest.body).append(h('ul', { class: 'why-list' },
        tip('Brief first, question last.', 'Everything that stays the same goes at the top; the new question goes at the end.'),
        tip('Keep the brief word-for-word identical.', 'A date, a name or a campaign ID inside it means nothing matches.'),
        tip('Make it big enough.', 'About ' + minWords + ' words on ' + p.label + ' before it can be kept on file.'),
        tip('Keep the questions coming.', 'A copy lasts five minutes after its last use, and each question resets the clock.'),
        tip('Stay on one model and effort level.', 'Switching starts the copy over, and you pay to save it again.')));

      const max = Math.max(perQ.full, short ? perQ.full : perQ.save);
      const cell = (n, kind, cost, caption) => {
        const bar = h('div', { class: 'why-bar' }, h('div', { class: 'seg-blk ' + kind }), h('div', { class: 'seg-blk ask' }));
        bar.firstChild.style.width = 'calc((100% - 30px) * ' + (cost / max).toFixed(4) + ')';
        return h('div', { class: 'why-cell' },
          h('div', { class: 'why-q', text: 'Question ' + n }),
          h('div', { class: 'why-track' }, bar),
          h('div', { class: 'why-price' }, h('strong', { text: formatUSD(cost + perQ.ask) }), ' ' + caption));
      };
      const lane = (title, sub, cells, total) => h('div', { class: 'why-lane' },
        h('div', { class: 'why-lane-label' }, h('div', { class: 'why-lane-title', text: title }), h('div', { class: 'why-lane-sub', text: sub })),
        cells,
        h('div', { class: 'why-total' }, h('div', { class: 'label', text: '4 questions' }), h('div', { class: 'why-total-v', text: formatUSD(total) })));
      const withoutTotal = 4 * (perQ.full + perQ.ask);
      const withTotal = short ? withoutTotal : perQ.save + 3 * perQ.file + 4 * perQ.ask;
      clear(E.whyLanes).append(
        lane('Without caching', 'The whole brief is read again with every question.',
          [1, 2, 3, 4].map((n) => cell(n, 'full', perQ.full, 'full brief')), withoutTotal),
        lane('With caching', short ? 'Too short to keep on file: it needs about ' + minWords + ' words.' : 'The brief is kept on file; only the new question is read in full.',
          [1, 2, 3, 4].map((n) => short ? cell(n, 'full', perQ.full, 'full brief')
            : n === 1 ? cell(n, 'save', perQ.save, 'brief saved') : cell(n, 'file', perQ.file, 'from file')), withTotal));
      const size = (real ? 'this ' + formatTokens(Math.round((brief * 0.75) / 10) * 10) : 'a ' + formatTokens(Math.round(EXAMPLE_BRIEF * 0.75))) + '-word brief';
      const saved = withoutTotal > 0 ? Math.round((1 - withTotal / withoutTotal) * 100) : 0;
      clear(E.whyFoot).append('Four questions with ' + size + ' on ' + p.label + ': ', h('strong', { text: formatUSD(withoutTotal) }), ' without caching, ',
        h('strong', { text: formatUSD(withTotal) }), ' with it' + (saved > 0 ? ', ' + saved + '% less for exactly the same answers.' : '.') +
        ' What the AI writes back is charged the same either way.');
    }

    // ---------- The library ----------
    function buildShelf(v) {
      v.append(head(HEADS.shelf[0], HEADS.shelf[1]).el);
      E.shelfChips = h('div', { class: 'chips' });
      E.shelfQ = h('div', { class: 'question-line' });
      const stat = (label, cls) => {
        const value = h('div', { class: 'value ' + (cls || '') });
        const sub = h('div', { class: 'stat-sub' });
        return { el: h('div', { class: 'shelf-stat' }, h('div', { class: 'label', text: label }), value, sub), value, sub };
      };
      E.sLib = stat('If the whole library went with every question');
      E.sSent = stat('Sent with this question', 'money');
      E.sShare = stat('Share of library');
      E.shelfGrid = h('div', { class: 'shelf-grid' });
      v.append(E.shelfChips, E.shelfQ, h('div', { class: 'shelf-top' }, E.sLib.el, E.sSent.el, E.sShare.el), E.shelfGrid);
    }

    function currentRelevant() {
      const k = app.state.knowledge || {};
      const q = app.shelfQuestion;
      if (!q) return k.defaultRelevant || [];
      const preset = (app.state.questions || []).find((x) => x.id === q.id || x.text === q.text);
      return TW.relevance.pickRelevant(q.text, k.categories || [], {
        preset: preset && preset.categories,
        fallback: k.defaultRelevant || [],
      });
    }

    function renderShelf() {
      const st = app.state;
      if (!st || !E.shelfGrid) return;
      const k = st.knowledge || { categories: [] };
      const cats = k.categories || [];
      const full = app.settings.contextMode === 'full';
      const rel = new Set(currentRelevant());
      const price = currentPrice();
      markChip(E.shelfChips, app.shelfQuestion && app.shelfQuestion.id);
      E.shelfQ.textContent = '';
      if (app.shelfQuestion) E.shelfQ.append('Q: ', h('strong', { text: app.shelfQuestion.text }));
      else E.shelfQ.textContent = full ? 'Send everything is on: every shelf goes with every question.' : 'Pick a question to see which shelves it needs.';

      const totalTokens = k.totalTokens || cats.reduce((n, c) => n + (c.tokenCount || 0), 0);
      const totalFiles = k.totalFiles || cats.reduce((n, c) => n + (c.fileCount || 0), 0);
      const lit = cats.filter((c) => full || rel.has(c.id));
      const sentTokens = lit.reduce((n, c) => n + (c.tokenCount || 0), 0);
      const sentFiles = lit.reduce((n, c) => n + (c.fileCount || 0), 0);
      E.sLib.value.textContent = formatUSD(sendCost(totalTokens, price));
      E.sLib.sub.textContent = files(totalFiles) + ' \u00b7 ' + compactTokens(totalTokens) + ' tokens';
      E.sSent.value.textContent = formatUSD(sendCost(sentTokens, price));
      E.sSent.sub.textContent = files(sentFiles) + ' \u00b7 ' + compactTokens(sentTokens) + ' tokens';
      E.sShare.value.textContent = totalTokens ? Math.round((sentTokens / totalTokens) * 100) + '%' : '\u2014';
      E.sShare.sub.textContent = price ? 'At ' + price.label + ' prices' : '';

      clear(E.shelfGrid);
      const rows = Math.max(1, Math.ceil(cats.length / 4));
      E.shelfGrid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0, 1fr))';
      for (const c of cats) {
        const on = full || rel.has(c.id);
        E.shelfGrid.append(h('div', { class: 'tile' + (on ? ' lit' : ''), 'data-cat': c.id },
          h('div', { class: 'tile-state', text: on ? 'Sent' : 'Left on shelf' }),
          h('div', { class: 'tile-name', text: c.name }),
          c.blurb ? h('div', { class: 'tile-blurb', text: c.blurb }) : null,
          h('div', { class: 'tile-stats' },
            h('span', { class: 'tile-cost', text: formatUSD(sendCost(c.tokenCount || 0, price)) }),
            ' \u00b7 ' + files(c.fileCount || 0) + ' \u00b7 ' + compactTokens(c.tokenCount || 0) + ' tokens')));
      }
    }

    // ---------- At Scale ----------
    function buildScale(v) {
      v.append(head(HEADS.scale[0], HEADS.scale[1]).el);
      E.scaleTable = h('table', { class: 'scale-table' });
      E.scaleSaved = h('span', { class: 'scale-saved-num' });
      v.append(h('div', { class: 'scale-saved' }, E.scaleSaved, ' in total savings'), h('div', { class: 'panel scale-panel' }, E.scaleTable));
    }

    function renderScale() {
      const s = app.state && app.state.atScale;
      if (!E.scaleTable || !s) return;
      const p = priceOf(s.model);
      if (!p) return;
      const n = s.questions || 1000;
      const uncached = (t) => (t * p.input * n) / PER;
      const cached = (t) => (t * (p.cacheWrite5m + (n - 1) * p.cacheRead)) / PER;
      const usd = (x) => '$' + Math.round(x).toLocaleString('en-US');
      const tok = (t) => (t >= 1e6 ? (t / 1e6).toFixed(2) + 'M' : Math.round(t / 1e3) + 'K');
      const pct = (u, c) => (u > 0 ? (((u - c) / u) * 100).toFixed(1) + '%' : '\u2014');
      const row = (cls, name, docs, t, prefix) => h('tr', { class: cls },
        h('td', { text: name }), h('td', { text: docs.toLocaleString('en-US') }), h('td', { text: (prefix || '') + tok(t) }),
        h('td', { class: 'money', text: usd(uncached(t)) }), h('td', { class: 'money', text: usd(cached(t)) }),
        h('td', { class: 'good', text: pct(uncached(t), cached(t)) }));
      const rows = s.rows || [];
      const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
      clear(E.scaleTable).append(
        h('thead', {}, h('tr', {}, [s.firstColumn || 'Intelligence', 'Documents', 'Tokens', 'Uncached cost', 'Cached cost', '% Savings'].map((t) => h('th', { text: t })))),
        h('tbody', {}, rows.map((r) => row('', r.name, r.documents, r.tokens)), row('total', 'Total', sum('documents'), sum('tokens'), '~')));
      E.scaleSaved.textContent = usd(uncached(sum('tokens')) - cached(sum('tokens')));
    }

    // ---------- Watch my app ----------
    let watchStarted = false;
    function watchOrigin() {
      const port = (app.state && app.state.watchPort) || 4174;
      return 'http://' + location.hostname + ':' + port;
    }
    function watchTimeLabel(at) {
      if (!at) return '\u2014';
      const s = Math.round((Date.now() - at) / 1000);
      if (s < 5) return 'just now';
      if (s < 60) return s + 's ago';
      const m = Math.round(s / 60);
      if (m < 60) return m + 'm ago';
      return Math.round(m / 60) + 'h ago';
    }
    function watchRow(call) {
      const u = call.usage || {};
      const el = h('div', { class: 'watch-row' },
        h('span', { text: (call.model || 'unknown') + (call.priced === false ? ' (no price on file)' : '') }),
        h('span', { text: formatTokens(u.input) + ' / ' + formatTokens(u.output) }),
        h('span', { class: 'watch-cache', text: u.cacheRead ? formatTokens(u.cacheRead) : '\u2014' }),
        h('span', { class: 'watch-cost', text: formatUSD(call.cost && call.cost.total) }),
        h('span', { text: Math.round(call.latencyMs || 0) + 'ms' }),
        h('span', { class: 'watch-time', text: watchTimeLabel(call.at) }));
      el.dataset.at = call.at || '';
      return el;
    }
    function renderWatchTotals(s) {
      if (!E.watchCards) return;
      E.watchCards.calls.val.textContent = String((s && s.calls) || 0);
      E.watchCards.spent.val.textContent = formatUSD(s && s.totalCost);
      const tokTotal = (s && s.tokens && (s.tokens.input + s.tokens.output + s.tokens.cacheWrite + s.tokens.cacheRead)) || 0;
      E.watchCards.spent.sub.textContent = tokens(tokTotal);
      E.watchCards.uncached.val.textContent = formatUSD(s && s.totalUncached);
      const saved = ((s && s.totalUncached) || 0) - ((s && s.totalCost) || 0);
      const pct = s && s.totalUncached > 0 ? Math.round((saved / s.totalUncached) * 100) : null;
      E.watchCards.saved.val.textContent = pct === null ? '\u2014' : pct + '%';
      E.watchCards.saved.sub.textContent = pct === null ? '' : formatUSD(saved) + ' saved';
    }
    function renderWatchHistory(history) {
      clear(E.watchRows);
      const list = (history || []).slice().reverse();
      E.watchEmpty.classList.toggle('hidden', !!list.length);
      for (const call of list) E.watchRows.append(watchRow(call));
    }
    async function watchFetchSession() {
      try {
        const res = await fetch(watchOrigin() + '/api/session', { credentials: 'omit' });
        const json = await res.json();
        if (json && json.session) { renderWatchTotals(json.session); renderWatchHistory(json.session.history); }
      } catch {
        /* the proxy isn't running yet; stays on the empty state */
      }
    }
    async function watchReset() {
      try { await fetch(watchOrigin() + '/api/reset', { method: 'POST', credentials: 'omit' }); } catch { /* proxy not running */ }
      watchFetchSession();
    }
    function renderWatch() {
      if (!E.watchUrl) return;
      E.watchUrl.textContent = watchOrigin();
      if (watchStarted) return;
      watchStarted = true;
      watchFetchSession();
      try {
        const es = new EventSource(watchOrigin() + '/events');
        es.onmessage = (ev) => {
          let call;
          try { call = JSON.parse(ev.data); } catch { return; }
          E.watchEmpty.classList.add('hidden');
          E.watchRows.prepend(watchRow(call));
          while (E.watchRows.children.length > 200) E.watchRows.removeChild(E.watchRows.lastChild);
          watchFetchSession();
        };
      } catch {
        /* EventSource unavailable; the initial fetch above still ran once */
      }
      setInterval(() => {
        for (const el of E.watchRows.children) {
          const at = Number(el.dataset.at);
          if (at) el.querySelector('.watch-time').textContent = watchTimeLabel(at);
        }
      }, 5000);
    }
    function buildWatch(v) {
      v.append(head(HEADS.watch[0], HEADS.watch[1]).el);

      E.watchUrl = h('code', { class: 'inline-code', text: 'this address' });
      E.watchReset = h('button', { type: 'button', class: 'watch-reset', text: 'Reset' });
      E.watchReset.addEventListener('click', watchReset);
      v.append(h('div', { class: 'watch-head' },
        h('p', { class: 'watch-sub' },
          'A live meter for your own project\u2019s real Anthropic calls. Point your app at ', E.watchUrl,
          ' instead of ', h('code', { class: 'inline-code', text: 'api.anthropic.com' }), ', and every call it makes shows up here as it happens.'),
        E.watchReset));

      const card = (cls, label, sub) => {
        const val = h('div', { class: 'card-cost', text: '0' });
        const subEl = h('div', { class: 'card-tokens', text: sub || '' });
        return { el: h('div', { class: 'card ' + cls }, h('div', { class: 'label', text: label }), val, subEl), val, sub: subEl };
      };
      E.watchCards = {
        calls: card('', 'Calls seen', 'since this proxy started'),
        spent: card('c-cached', 'Spent (with caching)'),
        uncached: card('c-total', 'Would cost without caching'),
        saved: card('c-savings', 'Saved by caching'),
      };
      E.watchCards.spent.val.textContent = formatUSD(0);
      E.watchCards.uncached.val.textContent = formatUSD(0);
      E.watchCards.saved.val.textContent = '\u2014';
      v.append(h('div', { class: 'cards watch-cards' }, Object.values(E.watchCards).map((c) => c.el)));

      E.watchRows = h('div', { class: 'watch-rows' });
      E.watchEmpty = h('div', { class: 'watch-empty', text: 'No calls yet. Point your app\u2019s Anthropic client at the address above and this page will update as it makes real calls.' });
      v.append(h('div', { class: 'panel watch-list' },
        h('div', { class: 'panel-title', text: 'Real calls, newest first' }),
        h('div', { class: 'watch-row head' },
          h('span', { text: 'Model' }), h('span', { text: 'Tokens (in / out)' }), h('span', { text: 'Cache read' }),
          h('span', { text: 'Cost' }), h('span', { text: 'Latency' }), h('span', { text: 'Time' })),
        E.watchRows, E.watchEmpty));

      const copyWatch = h('button', { type: 'button', class: 'primary copy-btn', text: 'Copy the prompt' });
      copyWatch.addEventListener('click', () => copyText(WATCH_PROMPT, copyWatch));
      v.append(h('div', { class: 'reuse' },
        h('div', { class: 'panel reuse-prompt' },
          h('div', { class: 'reuse-title', text: 'Add it to your own project' }),
          h('p', { class: 'reuse-sub', text: 'Paste the prompt below into your preferred coding agent (Cursor, Codex, Claude Code, etc.) and press Enter.' }),
          h('div', { class: 'prompt-text scroll', text: WATCH_PROMPT }),
          copyWatch),
        h('div', { class: 'reuse-side' },
          h('div', { class: 'panel' },
            h('div', { class: 'reuse-title', text: 'Then watch it' }),
            h('ol', { class: 'how-steps' },
              h('li', {}, h('strong', { text: 'Start the meter. ' }), 'In this folder, run ', h('code', { class: 'inline-code', text: 'npm run watch' }), '.'),
              h('li', {}, h('strong', { text: 'Open it. ' }), 'A page opens at the address it prints, showing every real call your project makes from here on: the model, the tokens, the cost, and how much caching is saving.'),
              h('li', {}, h('strong', { text: 'Turn it off when you\u2019re done. ' }), 'Remove the line you added, or just stop the meter (Ctrl+C); nothing it saw is written to disk, and stopping it clears the running totals.'))))));
    }

    // ---------- Get started ----------
    function buildStart(v) {
      E.toolSeg = h('div', { class: 'seg tools', role: 'group', 'aria-label': 'Which tool you use' });
      const top = head('', '', E.toolSeg);
      E.startTitle = top.title;
      E.startSub = top.sub;
      E.steps = h('div', { class: 'steps' });
      v.append(top.el, E.steps);
    }

    function renderStart() {
      const g = app.state && app.state.getStarted;
      if (!E.views.start || !g) return;
      const tools = g.tools || [];
      if (!tools.find((t) => t.id === app.tool)) app.tool = tools.length ? tools[0].id : null;
      E.startTitle.textContent = g.title || '';
      E.startSub.textContent = g.subtitle || '';
      clear(E.toolSeg);
      for (const t of tools) {
        E.toolSeg.append(h('button', {
          type: 'button', 'data-value': t.id, 'aria-pressed': String(t.id === app.tool), text: t.name,
          onclick: () => { app.tool = t.id; renderStart(); },
        }));
      }
      const tool = tools.find((t) => t.id === app.tool) || { name: '', open: '' };
      const step = (n, title, key, cls, ...body) => h('div', { class: 'step step-' + n + (cls ? ' ' + cls : '') },
        h('div', { class: 'step-n', text: String(n) }),
        h('div', { class: 'step-body' }, h('div', { class: 'step-title' }, title, key ? info(key) : null), ...body));
      // Any config text field may hold a blank line to become more than one paragraph.
      const paragraphs = (text) => (text || '').split(/\n\n+/).filter(Boolean).map((t) => h('p', { text: t }));
      const setup = (g.paste && g.paste.setup) || '';
      const copyBtn = h('button', { type: 'button', class: 'primary copy-btn', text: 'Copy' });
      copyBtn.addEventListener('click', () => copyText(setup, copyBtn));
      const r = g.resources || {};
      const toolCard = (item) => h('a', {
        class: 'tool-card', href: item.href, target: '_blank', rel: 'noopener noreferrer',
      },
        h('div', { class: 'tool-info' },
          h('div', { class: 'tool-name', text: item.name }),
          h('div', { class: 'tool-blurb', text: item.blurb }),
          h('div', { class: 'tool-link', text: item.linkText })),
        h('img', { class: 'tool-qr', src: item.qr, alt: 'QR code for ' + item.linkText, width: 130, height: 130, decoding: 'async' }));
      const step4 = step(4, (g.key && g.key.title) || 'Add your key', 'apiKey', null, ...paragraphs(g.key && g.key.text));
      const stackKids = [step4];
      if ((r.items || []).length) {
        stackKids.push(step(5, r.title || 'Tools', null, 'step-tools',
          ...paragraphs(r.text),
          h('div', { class: 'tool-cards' }, r.items.map(toolCard))));
      }
      const stepEls = [
        step(1, (g.download && g.download.title) || 'Download the file', null, null, ...paragraphs(g.download && g.download.text)),
        step(2, 'Open it in Claude Code, Codex or Cursor', null, null, ...paragraphs(tool.open)),
        step(3, (g.paste && g.paste.title) || 'Paste these setup instructions', null, null,
          ...paragraphs(g.paste && g.paste.text),
          h('div', { class: 'setup-box' }, h('div', { class: 'setup-text scroll', text: setup }), copyBtn)),
        h('div', { class: 'step-stack' }, ...stackKids),
      ];
      clear(E.steps).append(...stepEls);
    }

    // ---------- state ----------
    function refresh(state) {
      app.state = state;
      E.brandTitle.textContent = state.title || 'Token Wars';
      E.pageTitle.textContent = state.subtitle || HEADS.live[0];
      const hasAfter = !!(state.prompts && state.prompts.after && state.prompts.after.trim());
      if (!hasAfter && app.settings.promptVersion === 'after') app.settings.promptVersion = 'before';
      const hasLib = !!(state.knowledge && state.knowledge.categories && state.knowledge.categories.length);
      if (!hasLib) app.settings.contextMode = 'full';
      if (!priceOf(app.settings.model) && pickerList().length) app.settings.model = pickerList()[0].model;
      if (E.shelfChips) questionChips(E.shelfChips, (q) => { app.shelfQuestion = { text: q.text, id: q.id }; renderShelf(); });
      renderModelSelect();
      renderToggles();
      renderPriceText();
      renderShelf();
      renderScale();
      renderWatch();
      renderReuse();
      renderRules();
      renderWhy();
      renderStart();
      if (state.session) applySession(state.session);
    }

    (async () => {
      let state;
      try {
        state = await backend.init();
      } catch {
        state = null;
      }
      if (!state || !state.ok) {
        showView(views[0].id);
        showError((state && state.error) || { title: 'Not ready', message: 'This page could not load. Check the Token Wars window and restart it.' });
        return;
      }
      if (state.defaults) app.settings = { ...app.settings, ...state.defaults };
      refresh(state);
      showView(views[0].id);
      if (state.mode === 'stage' && !state.keyConfigured) {
        showError({ title: 'Not connected yet', message: 'The AI key is not set up on this computer yet.' });
      }
    })();

    return api;
  }

  TW.app = { start, h, clear, renderAnswer, HOVERS, LOGO_LINK };
})();
