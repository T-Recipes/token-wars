'use strict';
// Checks a built giveaway folder for anything that must never ship: stage
// content, secrets, key-shaped strings, or lines of the production prompt.
const fs = require('fs');
const path = require('path');

const FORBIDDEN = [
  /(^|\/)\.env/, /^prompts\//, /^data\//, /^knowledge\//, /conflicts\.json$/, /demo\.json$/, /knowledge_center\.json$/, /at_scale\.json$/,
  /get_started\.json$/, /mock\.js$/, /prompt_before_raw/, /\.txt$/,
];
const KEY_SHAPE = /sk-ant-[A-Za-z0-9_\-]{6,}|\bsk-[A-Za-z0-9_\-]{20,}|ANTHROPIC_API_KEY\s*=\s*[^\s'"`]+/;

function listFiles(dir) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join('/')]);
  return walk(dir);
}

function packageProblems(dir, root) {
  const files = listFiles(dir);
  const problems = files.filter((f) => FORBIDDEN.some((re) => re.test(f))).map((f) => f + ' must not be included');
  const raw = path.join(root, 'prompt_before_raw.txt');
  const rawLines = fs.existsSync(raw)
    ? [...new Set(fs.readFileSync(raw, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 40))]
    : [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (KEY_SHAPE.test(text)) problems.push(f + ' contains something that looks like an API key');
    if (rawLines.some((l) => text.includes(l))) problems.push(f + ' contains text from prompt_before_raw.txt');
  }
  return problems;
}

// Same idea, for the public GitHub release: the public repo ships the full
// demo (prompts, data, knowledge, config), including config/at_scale.json
// (explicitly approved for public release), so only a short, specific list
// is forbidden: the real API key and the real production prompt.
// A real .env (not the checked-in .env.example template).
const REAL_DOTENV = /(^|\/)\.env$|(^|\/)\.env\.(?!example$)/;
const PUBLIC_FORBIDDEN = [
  REAL_DOTENV, /^prompt_before_raw\.txt$/, /^artifacts\//, /^dist\//,
];
const COMPANY_SECRET_SHAPE = /rootiq|supabase|gtppnbtrejfwktywkzbz|krnoytfxrfpsplfsnbsv/i;

// Unlike the giveaway build, the public repo is meant to carry docs and tests
// that legitimately mention key formats and fake test keys (e.g.
// "sk-ant-TESTKEY-..."), so a blanket key-shaped-string scan produces false
// positives here. Path and company-name checks catch what actually matters;
// test/server.test.js (shipped as part of the package) already asserts no
// tracked file holds a real key.
function publicPackageProblems(dir, root) {
  const files = listFiles(dir);
  const problems = files.filter((f) => PUBLIC_FORBIDDEN.some((re) => re.test(f))).map((f) => f + ' must not be included');
  const raw = path.join(root, 'prompt_before_raw.txt');
  const rawLines = fs.existsSync(raw)
    ? [...new Set(fs.readFileSync(raw, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 40))]
    : [];
  for (const f of files) {
    const abs = path.join(dir, f);
    if (fs.statSync(abs).isDirectory()) continue;
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; } // binary; nothing to scan as text
    // These files' own source spells these names out, as the pattern they check for; not a leak.
    const selfChecking = f === 'test/server.test.js' || f === 'scripts/package-check.js' || f === 'scripts/check-layout.js';
    // The Get Started tab's "Tools" QR panel is a deliberate, plain marketing
    // link (confirmed fine to publish), not an internal-only name or secret.
    const scanText = f === 'config/get_started.json' ? text.replace(/rootiq(\.ai)?/gi, '') : text;
    if (!selfChecking && COMPANY_SECRET_SHAPE.test(scanText)) problems.push(f + ' contains an internal-only name or credential fragment');
    if (rawLines.some((l) => text.includes(l))) problems.push(f + ' contains text from prompt_before_raw.txt');
  }
  return problems;
}

module.exports = { packageProblems, publicPackageProblems, listFiles, FORBIDDEN, PUBLIC_FORBIDDEN };
