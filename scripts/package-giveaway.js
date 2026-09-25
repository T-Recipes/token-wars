'use strict';
// Builds dist/token-wars-giveaway/ (and a .zip when `zip` is available): the
// giveaway page plus the shared UI and price table. It never includes prompts,
// demo data, knowledge pages, or .env; the build fails if any sneak in.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { packageProblems, listFiles } = require('./package-check.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'token-wars-giveaway');

const FILES = [
  ['giveaway/index.html', 'giveaway/index.html'],
  ['giveaway/giveaway.js', 'giveaway/giveaway.js'],
  ['giveaway/serve.js', 'giveaway/serve.js'],
  ['giveaway/SETUP.md', 'SETUP.md'],
  ['giveaway/start.command', 'start.command'],
  ['giveaway/start.bat', 'start.bat'],
  ['lib/http.js', 'lib/http.js'],
  ['config/pricing.json', 'config/pricing.json'],
  ['assets/V3_Stacked_TR_RIQ_White.svg', 'assets/V3_Stacked_TR_RIQ_White.svg'],
  ['public/shared/cost.js', 'public/shared/cost.js'],
  ['public/shared/errors.js', 'public/shared/errors.js'],
  ['public/shared/relevance.js', 'public/shared/relevance.js'],
  ['public/shared/harness.js', 'public/shared/harness.js'],
  ['public/shared/app.js', 'public/shared/app.js'],
  ['public/shared/stage.css', 'public/shared/stage.css'],
];

fs.rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const dest = path.join(OUT, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), dest);
}
fs.chmodSync(path.join(OUT, 'start.command'), 0o755);

const problems = packageProblems(OUT, ROOT);
if (problems.length) {
  console.error('Refusing to package:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const files = listFiles(OUT);

let zipped = false;
try {
  fs.rmSync(OUT + '.zip', { force: true });
  execFileSync('zip', ['-qr', path.basename(OUT) + '.zip', path.basename(OUT)], { cwd: path.dirname(OUT) });
  zipped = true;
} catch { /* zip not installed: folder is still usable */ }

console.log('Giveaway package ready: ' + path.relative(ROOT, OUT) + (zipped ? ' (and .zip)' : '') + ', ' + files.length + ' files.');
