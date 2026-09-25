'use strict';
// Builds dist/token-wars-public/: a fresh, single-commit snapshot of exactly
// what's tracked in git (so .env, artifacts/, dist/, and prompt_before_raw.txt
// are already out, since none of those are ever committed).
//
// config/at_scale.json (the At Scale case study numbers) is included as-is;
// publishing it publicly has been explicitly approved. If that changes in the
// future, strip it here again and re-add it to PUBLIC_FORBIDDEN in
// package-check.js so the two stay in sync.
//
// This script only builds and checks the local folder. It does not touch
// GitHub; publishing is a separate, explicit step so a person reviews the
// snapshot first.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { publicPackageProblems, listFiles } = require('./package-check.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'token-wars-public');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// git archive of HEAD: exactly the tracked, committed file set, nothing local
// or gitignored sneaks in.
const tar = execFileSync('git', ['archive', 'HEAD'], { cwd: ROOT, maxBuffer: 1024 * 1024 * 200 });
execFileSync('tar', ['-x', '-C', OUT], { input: tar });

const problems = publicPackageProblems(OUT, ROOT);
if (problems.length) {
  console.error('Refusing to package:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const files = listFiles(OUT);
console.log('Public package ready: ' + path.relative(ROOT, OUT) + ', ' + files.length + ' files.');
console.log('Not published yet. To review it: cd ' + path.relative(ROOT, OUT) + ' && npm test && npm run check:layout');
console.log('To publish, see docs/PUBLISH.md.');
