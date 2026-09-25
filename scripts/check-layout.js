'use strict';
// Rehearsal check: opens every view at 1920x1080 in headless Chrome (rehearsal
// mode, no API calls) and fails on horizontal overflow, clipped elements, text
// under 18px, console errors, a giveaway key appearing in the page, tooltips
// leaving the screen, a mis-sized logo, or jargon and demo-disclosure words.
// Screenshots go to artifacts/. Usage: npm run check:layout
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts');
const PORT = 4199;
const CDP_PORT = 9344;
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
const FAKE_KEY = 'sk-ant-TESTKEY-layoutcheck-0123456789abcdef';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await sleep(200);
  }
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  return new Promise((resolve) => {
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      on: (fn) => listeners.push(fn),
      close: () => ws.close(),
    });
  });
}

const MEASURE = `(() => {
  const W = innerWidth, H = innerHeight, issues = [];
  const de = document.documentElement;
  if (de.scrollWidth > W + 1) issues.push('page scrolls horizontally: ' + de.scrollWidth + 'px wide');
  if (document.body.scrollWidth > W + 1) issues.push('body wider than viewport: ' + document.body.scrollWidth);
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.hidden'); };
  const desc = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' "' + (el.textContent || el.value || el.placeholder || '').trim().slice(0, 40) + '"';
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && (el.value || el.placeholder));
    if (ownText && parseFloat(cs.fontSize) < 18) issues.push('text under 18px (' + cs.fontSize + '): ' + desc(el));
    if (r.right > W + 1) issues.push('extends past right edge (' + Math.round(r.right) + 'px): ' + desc(el));
    if (r.bottom > H + 1 && !el.closest('.scroll')) issues.push('extends below screen (' + Math.round(r.bottom) + 'px): ' + desc(el));
    if (cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 2 && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') issues.push('content cut off horizontally: ' + desc(el));
  }
  return [...new Set(issues)];
})()`;

// Words that must never appear on screen or in a tooltip. Code samples, the
// paste-in prompt and AI answers are excluded; "API key" is allowed because it is explained.
const BANNED = /rehears|simulat|placeholder|sample content|\bmock|recorded|replay|no live|not live|context (sent|window|mode)|fan-?out|\bjson\b|endpoint|\.env\b|localhost|127\.0\.0\.1|model calls?\b|\bapi\b(?! key| connected)|warm-?up|\bdemo\b/i;

const SCAN = `(() => {
  const texts = [];
  const walk = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.parentElement.closest('.code, code, .prompt-text, .setup-text, .answer, input, textarea, select') && n.nodeValue.trim()) texts.push(n.nodeValue);
  }
  document.querySelectorAll('select option').forEach((o) => texts.push(o.textContent));
  document.querySelectorAll('.info').forEach((b) => { b.dispatchEvent(new MouseEvent('mouseenter')); texts.push(document.querySelector('.tip').textContent); b.dispatchEvent(new MouseEvent('mouseleave')); });
  document.querySelectorAll('.tabs button, [aria-label], [placeholder]').forEach((e) => texts.push(e.textContent, e.getAttribute('aria-label') || '', e.getAttribute('placeholder') || ''));
  return texts.join('\\n');
})()`;

const TIPS = `(() => {
  const bad = [];
  const shown = [...document.querySelectorAll('.info')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('.hidden'));
  for (const b of shown) {
    b.dispatchEvent(new MouseEvent('mouseenter'));
    const t = document.querySelector('.tip');
    const r = t.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(t).fontSize);
    if (t.classList.contains('hidden') || !t.textContent.trim()) bad.push('tooltip did not open for ' + b.dataset.tipKey);
    if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) bad.push('tooltip off screen: ' + b.dataset.tipKey);
    if (fs < 18) bad.push('tooltip text under 18px: ' + b.dataset.tipKey);
    b.dispatchEvent(new MouseEvent('mouseleave'));
  }
  return { count: shown.length, bad };
})()`;

async function main() {
  if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--mock', '--port=' + PORT], { stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-domain-reliability',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--window-size=1920,1080', 'about:blank',
  ], { stdio: 'ignore' });
  let failures = 0;
  try {
    await waitFor(() => fetch('http://127.0.0.1:' + PORT + '/api/state').then((r) => r.ok));
    const targets = await waitFor(() => fetch('http://127.0.0.1:' + CDP_PORT + '/json/list').then((r) => r.json()).then((t) => t.find((x) => x.type === 'page')));
    const cdp = await cdpClient(targets.webSocketDebuggerUrl);
    const consoleErrors = [];
    cdp.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
      // The watch tab always tries to reach the separate watch proxy (default
      // port 4174) so its cards come alive the moment that proxy is started;
      // in this headless check nothing is listening there (or, if a real
      // proxy from the developer's own terminal happens to be running, its
      // CORS response is unrelated to this test), so those attempts are
      // expected background noise, not a real page bug.
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon|api\.anthropic\.com|:4174\b/.test(m.params.entry.url || '') && !/:4174\b/.test(m.params.entry.text || '')) consoleErrors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

    const js = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page script failed: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
      return r.result.value;
    };
    const go = (id) => js(`(document.querySelector('.tabs button[data-view=${id}]').click(), true)`);
    const key = (k) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true })), true`);
    const idle = () => waitFor(() => js(`!document.querySelector('.app.busy')`));
    const shot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    };
    const check = async (name) => {
      await sleep(900);
      const issues = await js(MEASURE);
      await shot(name);
      const status = issues.length ? 'FAIL' : 'ok  ';
      console.log(status + ' ' + name + (issues.length ? '\n       ' + issues.slice(0, 12).join('\n       ') : ''));
      failures += issues.length ? 1 : 0;
    };
    const scanned = [];
    const scan = async (where) => { scanned.push([where, await js(SCAN)]); };
    const tips = async (where) => {
      const r = await js(TIPS);
      console.log((r.bad.length ? 'FAIL' : 'ok  ') + ' ' + where + ': ' + r.count + ' info tooltips open on screen' + (r.bad.length ? '\n       ' + r.bad.join('\n       ') : ''));
      failures += r.bad.length ? 1 : 0;
    };
    const askLive = async (q) => {
      await js(`(() => { const i = document.querySelector('.ask-box input'); i.value = ${JSON.stringify(q)}; i.form.requestSubmit(); return true; })()`);
      await idle();
    };
    const pick = (name, value) => js(`(() => { const s = document.querySelector('select[data-setting=${name}]'); s.value = '${value}'; s.dispatchEvent(new Event('change')); return s.value === '${value}'; })()`);
    const Q1 = 'Which campaign had the best completion rate, and why do you think it did?';
    const Q4 = 'If we could move ten percent of total spend next quarter, where should it go?';
    const load = async (url) => {
      await cdp.send('Page.navigate', { url });
      await waitFor(() => js(`!!document.querySelector('.tabs button')`));
      await sleep(500);
    };

    // ---- Stage ----
    await load('http://127.0.0.1:' + PORT + '/');
    const order = await js(`[...document.querySelectorAll('.tabs button')].map((b) => b.textContent).join(' | ')`);
    const landing = await js(`document.querySelector('.tabs button[aria-selected=true]').textContent`);
    await key('6');
    const sixth = await js(`document.querySelector('.tabs button[aria-selected=true]').textContent`);
    // config/at_scale.json is optional (the public release ships without it); when it's
    // there the menu carries "At Scale" right before "Watch my app", otherwise it goes
    // straight from Token Cost to "Watch my app".
    const hasAtScale = / At Scale \| Watch my app$/.test(order);
    const orderOk = order === 'Get Started | WTF is Cache? | How to Cache | Cache Cleanup | Before & After | Token Cost | ' + (hasAtScale ? 'At Scale | ' : '') + 'Watch my app' &&
      landing === 'Get Started' && sixth === 'Token Cost';
    console.log((orderOk ? 'ok  ' : 'FAIL') + ' menu order ' + order + '; opens on ' + landing + '; key 6 opens ' + sixth);
    if (!orderOk) failures++;
    const help = await js(`(() => { const secs = [...document.querySelectorAll('section[data-view]')]; const bad = secs.filter((s) => { const a = s.querySelectorAll('.sec-head .get-help-btn'); return a.length !== 1 || a[0].textContent !== 'Get Help' || a[0].href !== 'https://calendly.com/techrecipes/tech-recipes-clone' || a[0].target !== '_blank' || !/noopener/.test(a[0].rel) || !/If you\u2019re stuck/.test(s.querySelector('.get-help').textContent); }).map((s) => s.dataset.view); return { n: secs.length, bad: bad.join(',') }; })()`);
    console.log((help.bad ? 'FAIL' : 'ok  ') + ' get help button on all ' + help.n + ' pages' + (help.bad ? ', missing on ' + help.bad : ''));
    if (help.bad) failures++;
    await go('live');
    await check('stage-1-live-empty');
    const logo = await js(`(() => { const i = document.querySelector('img.logo'); const r = i.getBoundingClientRect(); const a = i.closest('a'); return { ok: i.complete && i.naturalWidth > 0, w: r.width, h: Math.round(r.height), top: Math.round(r.top), titleTop: Math.round(document.querySelector('.brand-title').getBoundingClientRect().top), href: a && a.href, want: new URL(TW.app.LOGO_LINK).href, target: a && a.target, rel: a && a.rel }; })()`);
    const logoOk = logo.ok && logo.w >= 85 && logo.w <= 95 && Math.abs(logo.h - logo.w * 378.3 / 504.7) <= 2 && logo.titleTop > logo.top + logo.h &&
      logo.href === logo.want && logo.target === '_blank' && /noopener/.test(logo.rel);
    console.log((logoOk ? 'ok  ' : 'FAIL') + ' logo loaded at ' + logo.w + 'x' + logo.h + 'px above the title, linking to ' + logo.href);
    if (!logoOk) failures++;
    const clip = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 340, height: 220, scale: 2 } });
    fs.writeFileSync(path.join(OUT, 'stage-logo-2x.png'), Buffer.from(clip.data, 'base64'));
    await tips('stage sidebar and one answer');
    await js(`document.querySelector('.info[data-tip-key=model]').dispatchEvent(new MouseEvent('mouseenter')), true`);
    await check('stage-1-tooltip-open');
    await js(`document.querySelector('.info[data-tip-key=model]').dispatchEvent(new MouseEvent('mouseleave')), true`);
    const tile = (k, part) => js(`document.querySelector('.card.c-${k} .card-${part || 'cost'}').textContent`);
    const dollars = (t) => Number((String(t).match(/[0-9][0-9,]*\.?[0-9]*/) || ['NaN'])[0].replace(/,/g, ''));
    await askLive(Q1);
    await askLive(Q4);
    await check('stage-1-live-cached');
    await scan('token cost');
    const savings = await tile('savings');
    console.log((/^\d+%$/.test(savings) && parseInt(savings, 10) > 0 ? 'ok  ' : 'FAIL') + ' percent savings tile after reuse: ' + savings);
    if (!(/^\d+%$/.test(savings) && parseInt(savings, 10) > 0)) failures++;
    const without = dollars(await tile('total'));
    const withC = dollars(await tile('cached'));
    const row = await js(`[...document.querySelectorAll('section[data-view=live] .runs .run-row')[0].querySelectorAll('.run-v')].map((e) => e.textContent)`);
    const tilesOk = withC > 0 && without > withC && Math.abs(Math.round((1 - withC / without) * 100) - parseInt(savings, 10)) <= 1 &&
      dollars(row[0]) === without && dollars(row[1]) === withC;
    console.log((tilesOk ? 'ok  ' : 'FAIL') + ' cost without caching $' + without + ' > with caching $' + withC + '; comparison row ' + row.join(' / '));
    if (!tilesOk) failures++;
    const models = await js(`[...document.querySelectorAll('select[data-setting=model] option')].map((o) => o.textContent).join(', ')`);
    const efforts = await js(`[...document.querySelectorAll('select[data-setting=effort] option')].map((o) => o.textContent).join(', ')`);
    const contexts = await js(`[...document.querySelectorAll('select[data-setting=context] option')].map((o) => o.textContent).join(', ')`);
    const menusOk = models === 'Claude Sonnet 5, Claude Opus 5.5, Claude Fable 5.1' && efforts === 'Low, Medium, High' && contexts === '300K, 1M';
    console.log((menusOk ? 'ok  ' : 'FAIL') + ' dropdowns: ' + models + ' | ' + efforts + ' | ' + contexts);
    if (!menusOk) failures++;
    const ctx300 = await js(`document.querySelector('section[data-view=live] .ctx-note').textContent`);
    await pick('context', '1000000');
    const ctx1m = await js(`document.querySelector('section[data-view=live] .ctx-note').textContent`);
    const ctxOk = /^With 300K tokens of context, this answer would cost \$/.test(ctx300) && /^With 1M tokens of context/.test(ctx1m) && dollars(ctx1m.split('cost ')[1]) > dollars(ctx300.split('cost ')[1]);
    console.log((ctxOk ? 'ok  ' : 'FAIL') + ' context line: ' + JSON.stringify(ctx1m));
    if (!ctxOk) failures++;
    await check('stage-1-live-context-1m');
    await pick('context', '300000');
    const onSonnet = dollars(await tile('cached'));
    await pick('model', 'claude-fable-5-1');
    await sleep(1600);
    await askLive(Q4);
    const onFable = dollars(await tile('cached'));
    await pick('model', 'claude-opus-5-5');
    await sleep(1600);
    await askLive(Q4);
    const onOpus = dollars(await tile('cached'));
    const modelOk = onFable > onOpus && onOpus > onSonnet;
    console.log((modelOk ? 'ok  ' : 'FAIL') + ' same question, total cost: Sonnet $' + onSonnet + ' < Opus $' + onOpus + ' < Fable $' + onFable);
    if (!modelOk) failures++;
    await check('stage-1-live-other-model');
    await pick('model', 'claude-sonnet-5');
    await sleep(1600);
    await askLive(Q4);
    const lowOut = dollars(await tile('output', 'tokens'));
    await pick('effort', 'high');
    await sleep(1600);
    await askLive(Q4);
    const highOut = dollars(await tile('output', 'tokens'));
    console.log((highOut > lowOut ? 'ok  ' : 'FAIL') + ' high effort writes more: ' + lowOut + ' then ' + highOut + ' output tokens');
    if (!(highOut > lowOut)) failures++;
    await check('stage-1-live-high-effort');
    await pick('effort', 'low');
    await sleep(1600);
    await key('m');
    const collapsed = await js(`(() => ({ min: document.querySelector('.app').classList.contains('side-min'), side: Math.round(document.querySelector('.side').getBoundingClientRect().width), label: document.querySelector('.side-toggle').getAttribute('aria-label') }))()`);
    await check('stage-1-menu-minimized');
    await js(`document.querySelector('.side-toggle').click(), true`);
    const expanded = await js(`!document.querySelector('.app').classList.contains('side-min')`);
    const minOk = collapsed.min && collapsed.side < 100 && collapsed.label === 'Show menu' && expanded;
    console.log((minOk ? 'ok  ' : 'FAIL') + ' minimize button: menu ' + collapsed.side + 'px wide when minimized, restores on click');
    if (!minOk) failures++;
    await go('prompt'); await check('stage-2-how-to-cache');
    const how = await js(`(() => { const v = document.querySelector('section[data-view=prompt]'); return { steps: v.querySelectorAll('.how-steps li').length, copies: [...v.querySelectorAll('.copy-btn')].map((b) => b.textContent).join('/'), prompt: v.querySelector('.prompt-text').textContent.length, link: (() => { const a = v.querySelector('.how-steps a'); return a && a.textContent + ' ' + a.href + ' ' + a.target + ' ' + a.rel; })(), scrolls: (() => { const l = v.querySelector('.how-steps'); return l.scrollHeight <= l.clientHeight || getComputedStyle(l).overflowY === 'auto'; })() }; })()`);
    const howOk = how.steps === 6 && how.copies === 'Copy the prompt/Copy the line/Copy/Copy/Copy' && how.prompt > 500 && how.scrolls &&
      how.link === 'Click here https://calendly.com/techrecipes/tech-recipes-clone _blank noopener noreferrer';
    console.log((howOk ? 'ok  ' : 'FAIL') + ' how to cache: ' + how.steps + ' numbered steps, buttons ' + how.copies + ', link ' + how.link + (how.scrolls ? '' : ', steps cut off'));
    if (!howOk) failures++;
    await js(`(() => { const l = document.querySelector('section[data-view=prompt] .how-steps'); l.scrollTop = l.scrollHeight; return true; })()`);
    await check('stage-2-how-to-cache-steps-end');
    await js(`(() => { document.querySelector('section[data-view=prompt] .how-steps').scrollTop = 0; return true; })()`);
    await tips('how to cache');
    await scan('how to cache');
    await go('answers');
    const carried = await js(`(() => { const b = document.querySelector('.ask-box'); return { inView: !!b.closest('section[data-view=answers]'), value: b.querySelector('input').value }; })()`);
    const carryOk = carried.inView && carried.value === Q4;
    console.log((carryOk ? 'ok  ' : 'FAIL') + ' question from Token Cost is waiting on Before & After: ' + JSON.stringify(carried.value));
    if (!carryOk) failures++;
    await check('stage-3-answers-empty');
    await askLive(Q1);
    const cmp = await js(`(() => { const v = document.querySelector('section[data-view=answers]'); return { titles: [...v.querySelectorAll('.col-title')].map((t) => t.textContent).join(' / '), costs: [...v.querySelectorAll('.cmp-cost')].map((c) => c.textContent), summary: v.querySelector('.cmp-summary').textContent }; })()`);
    const cmpOk = cmp.titles === 'Without caching / With caching' && dollars(cmp.costs[1]) < dollars(cmp.costs[0]) / 2 && /^With caching, this answer costs \d+% less\.$/.test(cmp.summary);
    console.log((cmpOk ? 'ok  ' : 'FAIL') + ' before and after: ' + cmp.titles + ' ' + cmp.costs.join(' vs ') + ', "' + cmp.summary + '"');
    if (!cmpOk) failures++;
    await check('stage-3-answers');
    await js(`(() => { document.querySelector('.ask-box input').value = 'Which publisher has the lowest CPM?'; return true; })()`);
    await go('live');
    const back = await js(`(() => { const b = document.querySelector('.ask-box'); return !!b.closest('section[data-view=live]') && b.querySelector('input').value; })()`);
    console.log((back === 'Which publisher has the lowest CPM?' ? 'ok  ' : 'FAIL') + ' question from Before & After is waiting on Token Cost');
    if (back !== 'Which publisher has the lowest CPM?') failures++;
    await scan('before and after');
    await go('rules');
    await check('stage-4-rules-empty');
    const rl = await js(`(() => {
      const v = document.querySelector('section[data-view=rules]');
      const shown = [...v.querySelectorAll('.lines')].map((l) => {
        const r = l.getBoundingClientRect();
        return [...l.querySelectorAll('.line--conflict, .line--repeat, .line--resolved')].some((x) => { const b = x.getBoundingClientRect(); return b.top >= r.top && b.bottom <= r.bottom; });
      });
      return { box: !!v.querySelector('.ask-box'), head: v.querySelector('.sec-title').textContent, lines: [...v.querySelectorAll('.lines')].map((l) => l.children.length), shown,
        titles: [...v.querySelectorAll('.col-title')].map((t) => t.textContent).join(' / '), prices: !!v.querySelector('.rules-cost, .cmp-summary, .cmp-note') };
    })()`);
    const rlOk = !rl.box && rl.head && rl.lines.every((n) => n > 50) && rl.shown.every(Boolean) && rl.titles === 'Without caching / With caching' && !rl.prices;
    console.log((rlOk ? 'ok  ' : 'FAIL') + ' cache cleanup: no question box, ' + rl.lines.join(' and ') + ' lines, highlights on screen ' + rl.shown.join('/') + ', ' + rl.titles + (rl.prices ? ', but prices are showing' : ', no prices'));
    if (!rlOk) failures++;
    await check('stage-4-rules');
    await scan('rules cleanup');
    await go('why');
    await check('stage-5-why-cache');
    const why = await js(`(() => {
      const v = document.querySelector('section[data-view=why]');
      const w = (sel) => [...v.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().width);
      return { tiles: [...v.querySelectorAll('.why-tile .why-title')].map((t) => t.textContent).join(' | '), lanes: v.querySelectorAll('.why-lane').length,
        cells: v.querySelectorAll('.why-cell').length, full: w('.why-bar .seg-blk.full'), file: w('.why-bar .seg-blk.file') };
    })()`);
    const whyOk = why.tiles === 'What is Cache? | Why is Cache Important? | Caching Best Practices' && why.lanes === 2 && why.cells === 8 &&
      why.file.length === 3 && Math.max(...why.file) < Math.min(...why.full) / 4;
    console.log((whyOk ? 'ok  ' : 'FAIL') + ' why cache: ' + why.tiles + '; ' + why.lanes + ' lanes, file bars ' + why.file.map(Math.round).join('/') + 'px vs full ' + Math.round(why.full[0]) + 'px');
    if (!whyOk) failures++;
    await scan('why cache');
    if (hasAtScale) {
      await go('scale'); await check('stage-6-at-scale');
      const scale = await js(`(() => { const v = document.querySelector('section[data-view=scale]'); return {
        title: v.querySelector('.sec-title').textContent, saved: v.querySelector('.scale-saved').textContent, note: !!v.querySelector('.scale-note'), heads: [...v.querySelectorAll('th')].map((e) => e.textContent).join(' | '),
        rows: v.querySelectorAll('tbody tr').length, total: [...v.querySelectorAll('tr.total td')].map((e) => e.textContent).join(' | '),
        media: [...v.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map((e) => e.textContent).join(' | ') }; })()`);
      const scaleOk = scale.title === 'How we save our clients money and reduce overhead' && scale.rows === 13 && scale.saved === '$557,820 in total savings' && !scale.note &&
        scale.heads === 'Intelligence | Documents | Tokens | Uncached cost | Cached cost | % Savings' &&
        scale.media === 'Media | 28,770 | 24.01M | $240,124 | $6,297 | 97.4%' && scale.total === 'Total | 67,730 | ~57.28M | $572,843 | $15,023 | 97.4%';
      console.log((scaleOk ? 'ok  ' : 'FAIL') + ' at scale: ' + scale.saved + '; ' + scale.rows + ' rows; ' + scale.media + '; ' + scale.total);
      if (!scaleOk) failures++;
      await scan('at scale');
    }
    await go('watch'); await check('stage-6b-watch');
    const watch = await js(`(() => { const v = document.querySelector('section[data-view=watch]'); return {
      title: v.querySelector('.sec-title').textContent, prompt: v.querySelector('.prompt-text').textContent.length,
      copy: v.querySelector('.copy-btn').textContent, steps: v.querySelectorAll('.how-steps li').length,
      code: v.querySelector('.how-steps code.inline-code') ? v.querySelector('.how-steps code.inline-code').textContent : '',
      cards: v.querySelectorAll('.watch-cards .card').length,
      url: v.querySelector('.watch-sub code.inline-code').textContent,
      cols: [...v.querySelectorAll('.watch-row.head span')].map((e) => e.textContent).join(' | '),
      reset: v.querySelector('.watch-reset').textContent,
      empty: v.querySelector('.watch-empty').textContent.length > 10 }; })()`);
    const watchOk = watch.title === 'Watch it happen in your own project' && watch.prompt > 300 && watch.copy === 'Copy the prompt' && watch.steps === 3 &&
      watch.code === 'npm run watch' && watch.cards === 4 && /^https?:\/\//.test(watch.url) &&
      watch.cols === 'Model | Tokens (in / out) | Cache read | Cost | Latency | Time' && watch.reset === 'Reset' && watch.empty;
    console.log((watchOk ? 'ok  ' : 'FAIL') + ' watch my app: ' + watch.title + ', prompt ' + watch.prompt + ' chars, ' + watch.steps + ' steps, code "' + watch.code + '", ' + watch.cards + ' cards, url ' + watch.url);
    if (!watchOk) failures++;
    await tips('watch my app');
    await scan('watch my app');
    await go('start');
    for (const tool of ['cursor', 'codex', 'claude-code']) {
      await js(`document.querySelector('.seg.tools [data-value="${tool}"]').click(), true`);
      await check('stage-7-get-started-' + tool);
    }
    const steps = await js(`document.querySelectorAll('section[data-view=start] .step').length + '/' + document.querySelectorAll('section[data-view=start] .copy-btn').length`);
    console.log((steps === '5/1' ? 'ok  ' : 'FAIL') + ' get started shows 5 steps and 1 copy button (' + steps + ')');
    if (steps !== '5/1') failures++;
    const tools = await js(`(() => { const cards = [...document.querySelectorAll('section[data-view=start] .tool-card')]; return {
      n: cards.length,
      names: cards.map((c) => c.querySelector('.tool-name').textContent).join(' | '),
      links: cards.map((c) => c.href).join(' | '),
      qr: cards.every((c) => c.querySelector('.tool-qr').naturalWidth > 0) }; })()`);
    const toolsOk = tools.n === 3 && tools.names === 'RootIQ MCP | Token Wars | Get Help' && tools.qr;
    console.log((toolsOk ? 'ok  ' : 'FAIL') + ' get started tools: ' + tools.names + '; QR images loaded: ' + tools.qr);
    if (!toolsOk) failures++;
    await tips('get started');
    await scan('get started');
    await go('live');
    await js(`(() => { const i = document.querySelector('section[data-view=live] input'); i.value = 'simulate error'; i.form.requestSubmit(); return true; })()`);
    await idle();
    await check('stage-error-banner');
    const banner = await js(`document.querySelector('.banner').innerText`);
    console.log('     error banner: ' + JSON.stringify(banner));

    // ---- Giveaway ----
    await load('http://127.0.0.1:' + PORT + '/giveaway/');
    await check('giveaway-0-setup');
    await js(`(() => {
      const v = document.querySelector('section[data-view=setup]');
      const key = v.querySelector('input[type=password]');
      key.value = '${FAKE_KEY}';
      [...v.querySelectorAll('button')].find(b => b.textContent === 'Use key').click();
      const tas = v.querySelectorAll('textarea');
      tas[0].value = 'You are a helpful assistant. Answer briefly.';
      tas[1].value = 'Pricing\\nCPM is cost per thousand.\\n---\\nReach\\nReach is unique households.';
      tas[2].value = 'What is CPM?\\nWhat is reach?';
      [...v.querySelectorAll('button')].find(b => b.textContent.startsWith('Use these')).click();
      return true;
    })()`);
    await sleep(500);
    const leak = await js(`(() => {
      const html = document.documentElement.outerHTML;
      const values = [...document.querySelectorAll('input, textarea')].map(e => e.value).join(' ');
      return html.includes('${FAKE_KEY}') || values.includes('${FAKE_KEY}') || document.body.innerText.includes('${FAKE_KEY}');
    })()`);
    console.log((leak ? 'FAIL' : 'ok  ') + ' giveaway key absent from DOM after entry');
    if (leak) failures++;
    const chips = await js(`document.querySelectorAll('section[data-view=shelf] .chip').length`);
    console.log((chips === 2 ? 'ok  ' : 'FAIL') + ' giveaway setup applied (' + chips + ' question buttons)');
    if (chips !== 2) failures++;
    await check('giveaway-1-live');
    await scan('giveaway one answer');
    await go('why'); await check('giveaway-5-why-cache');
    await go('shelf'); await check('giveaway-6-shelf');
    await go('prompt'); await check('giveaway-3-prompt');
    await go('setup'); await tips('giveaway setup'); await scan('giveaway setup');

    if (process.argv.includes('--network')) {
      // Sends the fake key to api.anthropic.com to prove the browser-direct path
      // works and that a rejected key shows a readable message.
      await go('live');
      await askLive('What is CPM?');
      const msg = await js(`document.querySelector('.banner').classList.contains('hidden') ? '' : document.querySelector('.banner-title').textContent`);
      console.log((msg === 'Key not accepted' ? 'ok  ' : 'FAIL') + ' giveaway direct call with a fake key shows: ' + JSON.stringify(msg));
      if (msg !== 'Key not accepted') failures++;
      await check('giveaway-2-live-error');
    }

    const words = [];
    for (const [where, text] of scanned) {
      if (typeof text !== 'string' || text.length < 200) { words.push(where + ': could not read the screen text (' + typeof text + ')'); continue; }
      for (const line of text.split('\n')) {
        const m = line.match(BANNED);
        if (m) words.push(where + ': "' + m[0] + '" in ' + JSON.stringify(line.trim().slice(0, 90)));
      }
    }
    const uniq = [...new Set(words)];
    console.log((uniq.length ? 'FAIL' : 'ok  ') + ' no jargon or demo-disclosure words on screen or in tooltips (' + scanned.length + ' screens scanned)' + (uniq.length ? '\n       ' + uniq.slice(0, 20).join('\n       ') : ''));
    if (uniq.length) failures++;

    if (consoleErrors.length) {
      console.log('FAIL console errors:\n       ' + consoleErrors.join('\n       '));
      failures++;
    }
    cdp.close();
  } finally {
    chrome.kill();
    server.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failures ? '\n' + failures + ' check(s) failed. Screenshots in artifacts/.' : '\nAll layout checks passed. Screenshots in artifacts/.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('Layout check could not run: ' + e.message); process.exit(1); });
