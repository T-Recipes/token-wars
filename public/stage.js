// Stage backend: talks only to this local server. The API key never reaches the browser.
(function () {
  const TW = window.TW;

  async function post(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => null);
      return json || { ok: false, error: TW.errors.friendly('unknown') };
    } catch {
      return { ok: false, error: { title: 'Lost connection', message: 'This page lost its connection. Reload the page, and if that fails, restart Token Wars.' } };
    }
  }

  async function fetchState() {
    try {
      const res = await fetch('/api/state', { credentials: 'same-origin' });
      return await res.json();
    } catch {
      return { ok: false, error: { title: 'Lost connection', message: 'This page lost its connection. Reload the page, and if that fails, restart Token Wars.' } };
    }
  }

  // The menu (which tab exists, and its label) is built once, before the page
  // has any state, so it has to know up front whether this build carries the
  // At Scale case study. Fetch state once here rather than guessing, so a
  // build with no config/at_scale.json (the public repo) shows the library
  // tab instead of an empty "At Scale" tab.
  (async () => {
    const initial = await fetchState();
    let used = false;
    const backend = {
      getStarted: true,
      atScale: !!(initial && initial.ok && initial.atScale),
      watch: true,
      async init() {
        if (!used) { used = true; return initial; }
        return fetchState();
      },
      ask: ({ question, questionId, settings }) => post('/api/ask', { question, questionId, ...settings }),
      compare: ({ question, questionId, settings }) => post('/api/compare', { question, questionId, ...settings }),
      warm: (settings) => post('/api/warm', settings),
      reset: () => post('/api/reset'),
    };
    TW.app.start(backend);
  })();
})();
