// Token usage -> dollars. Shared by the Node server and the browser (giveaway).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.TW = root.TW || {}).cost = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PER = 1e6;

  function priceFor(pricing, model) {
    const p = pricing && pricing.models && pricing.models[model];
    if (!p) return null;
    return p;
  }

  function normalizeUsage(u) {
    u = u || {};
    return {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
    };
  }

  function computeCost(usage, price) {
    const input = (usage.input * price.input) / PER;
    const cacheWrite = (usage.cacheWrite * price.cacheWrite5m) / PER;
    const cacheRead = (usage.cacheRead * price.cacheRead) / PER;
    const output = (usage.output * price.output) / PER;
    const inputSide = input + cacheWrite + cacheRead;
    const inputSideUncached = ((usage.input + usage.cacheWrite + usage.cacheRead) * price.input) / PER;
    return {
      input,
      cacheWrite,
      cacheRead,
      output,
      inputSide,
      total: inputSide + output,
      inputSideUncached,
      totalUncached: inputSideUncached + output,
    };
  }

  function formatUSD(n) {
    if (!isFinite(n)) return '$0.00';
    if (n > 0 && n < 0.00005) return 'under $0.0001';
    if (Math.abs(n) < 1) return '$' + n.toFixed(4);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatTokens(n) {
    return Math.round(n || 0).toLocaleString('en-US');
  }

  function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  return { priceFor, normalizeUsage, computeCost, formatUSD, formatTokens, estimateTokens };
});
