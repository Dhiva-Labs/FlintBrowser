'use strict';

// Build the bundled adblock engine.
// Output: build/adblock-engine.bin (committed so packaged builds work offline).
//
// Lists: EasyList + EasyPrivacy for network blocking, plus uBlock Origin's
// filter lists and its scriptlet resources. Network rules alone cannot stop
// YouTube's video ads (they ride the same googlevideo.com hosts as the video
// itself); uBlock's lists carry the cosmetic rules and +js() scriptlets that
// strip ad placements from the page, which src/main/adblock.js injects.

const fs = require('fs');
const path = require('path');
const { FiltersEngine, adsAndTrackingLists } = require('@ghostery/adblocker');

// Ghostery's mirror of EasyList, EasyPrivacy and uBlock Origin's lists. Peter
// Lowe's server list is left out: its redistribution terms are unclear and
// EasyList already covers those ad servers.
const LISTS = adsAndTrackingLists.filter((url) => !url.includes('/peter-lowe/'));

(async () => {
  console.log(`[engine] fetching ${LISTS.length} filter lists + resources…`);
  const engine = await FiltersEngine.fromLists(fetch, LISTS, {
    loadCosmeticFilters: true,
    loadGenericCosmeticsFilters: true,
    loadNetworkFilters: true,
    loadExceptionFilters: true,
    loadExtendedSelectors: true,
  });
  const buf = engine.serialize();
  const out = path.join(__dirname, '..', 'build', 'adblock-engine.bin');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(buf));
  console.log(`[engine] wrote ${out} (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
})().catch((err) => {
  console.error('[engine] failed:', err.message);
  process.exit(1);
});
