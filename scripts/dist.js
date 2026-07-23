'use strict';

// Build one edition (standard or plus) from the single codebase.
//   node scripts/dist.js standard
//   node scripts/dist.js plus
//
// Both editions share all base config in package.json > build; this script
// overlays the per-edition identity (name / appId / product name / executable)
// and writes the runtime edition marker into the bundle before packaging.

const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const EDITIONS = {
  standard: {
    name: 'flint-browser',
    productName: 'Flint',
    appId: 'com.dhivalabs.flint',
    exe: 'flint-browser',
    synopsis: 'Fast private browser with built-in ad blocking',
  },
  plus: {
    name: 'flint-browser-plus',
    productName: 'Flint Plus',
    appId: 'com.dhivalabs.flintplus',
    exe: 'flint-browser-plus',
    synopsis: 'Fast private browser with adblock, BitTorrent and media tools',
  },
};

const editionId = process.argv[2];
const e = EDITIONS[editionId];
if (!e) {
  console.error('usage: node scripts/dist.js <standard|plus>');
  process.exit(1);
}

// 1. Write the runtime marker that edition.js reads inside the packaged app.
fs.writeFileSync(path.join(ROOT, 'src', 'edition-config.json'), JSON.stringify({ edition: editionId }, null, 2));

// 2. Overlay per-edition identity onto the base build config.
const config = JSON.parse(JSON.stringify(pkg.build));
config.appId = e.appId;
config.productName = e.productName;
config.extraMetadata = { name: e.name, productName: e.productName };
config.linux.executableName = e.exe;
config.linux.synopsis = e.synopsis;

// The standard edition physically ships without the Plus-only feature code or
// the BitTorrent library, so the "clean" build genuinely contains no torrent /
// grabber implementation — not merely a disabled one.
if (editionId === 'standard') {
  config.files = [
    ...pkg.build.files,
    '!src/main/torrents.js',
    '!src/main/grabber.js',
    '!src/pages/torrents.html',
    '!node_modules/webtorrent/**/*',
  ];
}
config.linux.desktop = config.linux.desktop || { entry: {} };
config.linux.desktop.entry.Name = e.productName;
config.linux.desktop.entry.StartupWMClass = e.exe;

console.log(`\n=== Building ${e.productName} (${editionId}) ===\n`);

build({
  targets: Platform.LINUX.createTarget(['deb', 'AppImage', 'tar.gz']),
  config,
}).then((files) => {
  console.log('\nArtifacts:');
  for (const f of files) if (/\.(deb|AppImage|tar\.gz)$/.test(f)) console.log('  ' + path.basename(f));
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
