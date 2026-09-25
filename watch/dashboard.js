(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const usd = (n) => {
    n = Number(n) || 0;
    if (n > 0 && n < 0.00005) return 'under $0.0001';
    if (Math.abs(n) < 1) return '$' + n.toFixed(4);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const tok = (n) => Math.round(n || 0).toLocaleString('en-US');
  const rows = $('w-rows');
  const empty = $('w-empty');

  $('w-url').textContent = location.origin;

  function renderTotals(s) {
    $('w-calls').textContent = String(s.calls || 0);
    $('w-total').textContent = usd(s.totalCost);
    $('w-tokens').textContent = tok((s.tokens && (s.tokens.input + s.tokens.output + s.tokens.cacheWrite + s.tokens.cacheRead)) || 0) + ' tokens';
    $('w-uncached').textContent = usd(s.totalUncached);
    const saved = (s.totalUncached || 0) - (s.totalCost || 0);
    const pct = s.totalUncached > 0 ? Math.round((saved / s.totalUncached) * 100) : null;
    $('w-savings').textContent = pct === null ? '\u2014' : pct + '% \u00b7 ' + usd(saved);
  }

  function timeLabel(at) {
    if (!at) return '\u2014';
    const s = Math.round((Date.now() - at) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.round(m / 60) + 'h ago';
  }

  function row(call) {
    const u = call.usage || {};
    const el = document.createElement('div');
    el.className = 'w-row';
    el.dataset.at = call.at || '';
    el.innerHTML =
      '<span>' + esc(call.model || 'unknown') + (call.priced === false ? ' <span class="w-no-price">(no price on file)</span>' : '') + '</span>' +
      '<span>' + tok(u.input) + ' / ' + tok(u.output) + '</span>' +
      '<span class="cache">' + (u.cacheRead ? tok(u.cacheRead) : '\u2014') + '</span>' +
      '<span class="cost">' + usd(call.cost && call.cost.total) + '</span>' +
      '<span>' + Math.round(call.latencyMs || 0) + 'ms</span>' +
      '<span class="w-time">' + timeLabel(call.at) + '</span>';
    return el;
  }

  function esc(s) {
    return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  }

  function renderHistory(history) {
    rows.innerHTML = '';
    const list = (history || []).slice().reverse();
    empty.style.display = list.length ? 'none' : 'block';
    for (const call of list) rows.append(row(call));
  }

  async function boot() {
    try {
      const res = await fetch('/api/session', { credentials: 'same-origin' });
      const json = await res.json();
      if (json && json.session) {
        renderTotals(json.session);
        renderHistory(json.session.history);
      }
    } catch {
      /* stays on empty state */
    }
  }

  function connect() {
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      let call;
      try {
        call = JSON.parse(ev.data);
      } catch {
        return;
      }
      empty.style.display = 'none';
      rows.prepend(row(call));
      while (rows.children.length > 200) rows.removeChild(rows.lastChild);
      fetch('/api/session', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((json) => json && json.session && renderTotals(json.session))
        .catch(() => {});
    };
    es.onerror = () => {
      es.close();
      setTimeout(connect, 2000);
    };
  }

  $('w-reset').addEventListener('click', async () => {
    await fetch('/api/reset', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    await boot();
  });

  setInterval(() => {
    for (const el of rows.children) {
      const at = Number(el.dataset.at);
      if (at) el.querySelector('.w-time').textContent = timeLabel(at);
    }
  }, 5000);

  boot();
  connect();
})();
