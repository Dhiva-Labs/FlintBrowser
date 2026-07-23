'use strict';

// Build the bundled adblock engine from EasyList + EasyPrivacy.
// Output: build/adblock-engine.bin (committed so packaged builds work offline).

const fs = require('fs');
const path = require('path');
const { FiltersEngine } = require('@ghostery/adblocker');

const LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
];

(async () => {
  console.log('[engine] fetching filter lists…');
  const engine = await FiltersEngine.fromLists(fetch, LISTS);
  const buf = engine.serialize();
  const out = path.join(__dirname, '..', 'build', 'adblock-engine.bin');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(buf));
  console.log(`[engine] wrote ${out} (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
})().catch((err) => {
  console.error('[engine] failed:', err.message);
  process.exit(1);
});
