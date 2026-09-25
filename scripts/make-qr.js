'use strict';
// Regenerates the QR code images used by the Get Started tab's "Tools"
// section (config/get_started.json's resources.items). Run this again,
// and by hand, only if one of those links ever changes; the images
// themselves are checked into assets/ and nothing at runtime calls out
// to the internet to redraw them.
//
//   node scripts/make-qr.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const content = require(path.join(ROOT, 'config', 'get_started.json'));

async function main() {
  const items = (content.resources && content.resources.items) || [];
  for (const item of items) {
    if (!item.href || !item.qr) continue;
    const url = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=0&data=' + encodeURIComponent(item.href);
    const res = await fetch(url);
    if (!res.ok) throw new Error('QR service returned ' + res.status + ' for ' + item.href);
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.join(ROOT, item.qr.replace(/^\//, ''));
    fs.writeFileSync(out, buf);
    process.stdout.write('Wrote ' + item.qr + ' for ' + item.href + '\n');
  }
}

main().catch((e) => {
  process.stdout.write('make-qr failed: ' + (e && e.message) + '\n');
  process.exit(1);
});
