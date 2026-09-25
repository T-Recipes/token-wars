// Picks which knowledge categories are "relevant" to a question.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.TW = root.TW || {}).relevance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function words(text) {
    return (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  }

  // categories: [{ id, name, keywords: [] }]
  // preset: optional list of category ids fixed for a known question
  function pickRelevant(question, categories, opts) {
    opts = opts || {};
    if (opts.preset && opts.preset.length) return opts.preset.slice();
    const qWords = new Set(words(question));
    const qText = (question || '').toLowerCase();
    const scored = (categories || []).map((c) => {
      let score = 0;
      for (const k of c.keywords || []) {
        const kw = k.toLowerCase();
        if (kw.includes(' ') ? qText.includes(kw) : qWords.has(kw)) score += 1;
      }
      for (const w of words(c.name)) if (w.length > 3 && qWords.has(w)) score += 1;
      return { id: c.id, score };
    });
    const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    const max = opts.max || 3;
    if (hits.length) return hits.slice(0, max).map((s) => s.id);
    return (opts.fallback || []).slice();
  }

  return { pickRelevant };
});
