'use strict';
// Scrubs secrets from anything that leaves the process (logs, HTTP responses).
const secrets = new Set();
const KEY_PATTERN = /sk-ant-[A-Za-z0-9_\-]{6,}/g;

function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 8) secrets.add(value);
}

function redactString(s) {
  if (typeof s !== 'string') return s;
  let out = s.replace(KEY_PATTERN, '[redacted]');
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function redactDeep(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/api[-_]?key|authorization|x-api-key/i.test(k)) continue;
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

function safeLog(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(redactDeep(p)))).join(' ');
  process.stdout.write(redactString(line) + '\n');
}

module.exports = { registerSecret, redactString, redactDeep, safeLog };
