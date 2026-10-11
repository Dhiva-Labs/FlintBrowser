'use strict';

// Build one edition (standard or plus) from the single codebase.
//   node scripts/dist.js standard
//   node scripts/dist.js plus
//   node scripts/dist.js standard --appx   (Windows only: Microsoft Store MSIX/AppX)
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

const args = process.argv.slice(2);
const editionId = args.find((a) => !a.startsWith('--'));
const wantAppx = args.includes('--appx');
const e = EDITIONS[editionId];
if (!e || args.some((a) => a.startsWith('--') && a !== '--appx')) {
  console.error('usage: node scripts/dist.js <standard|plus> [--appx]');
  process.exit(1);
}
if (wantAppx && (editionId !== 'standard' || process.platform !== 'win32')) {
  console.error('--appx builds the Microsoft Store package: standard edition, on Windows only');
  process.exit(1);
}

// Everything the standard edition needs at runtime is a handful of packages.
// The glob patterns below remove the BitTorrent stack by name, but webtorrent
// pulls in ~150 transitive packages (streams, buffers, DHT, ...) that no name
// pattern catches. So instead walk the real dependency graph: keep what the
// packages the standard edition uses (every production dependency except
// webtorrent) can reach, and exclude every other production package.
function unusedDependencyExcludes() {
  const readPkg = (dir) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; }
  };
  // Node resolution: nearest node_modules/<name> walking up from `from`.
  const resolveDep = (name, from) => {
    for (let d = from; d.startsWith(ROOT); d = path.dirname(d)) {
      const candidate = path.join(d, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    }
    return null;
  };
  const closure = (names) => {
    const seen = new Set();
    const queue = names.map((n) => resolveDep(n, ROOT)).filter(Boolean);
    while (queue.length) {
      const dir = queue.pop();
      if (seen.has(dir)) continue;
      seen.add(dir);
      const meta = readPkg(dir) || {};
      for (const dep of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies })) {
        const resolved = resolveDep(dep, dir);
        if (resolved && !seen.has(resolved)) queue.push(resolved);
      }
    }
    return seen;
  };

  const all = Object.keys(pkg.dependencies || {});
  const wanted = closure(all.filter((n) => n !== 'webtorrent'));
  for (const n of all) {
    if (n !== 'webtorrent' && !wanted.has(resolveDep(n, ROOT))) {
      throw new Error(`dependency ${n} is not installed - run npm ci first`);
    }
  }
  // electron-builder flattens nested copies (webtorrent/node_modules/mime ends up as
  // node_modules/mime in the app), so exclude each unused package both where it is
  // installed and by its bare name at the top level, unless a kept package has that name.
  const nameOf = (dir) => path.relative(ROOT, dir).split(path.sep).join('/').split('node_modules/').pop();
  const wantedNames = new Set([...wanted].map(nameOf));
  const excludes = new Set();
  for (const dir of closure(all)) {
    if (wanted.has(dir)) continue;
    excludes.add(`!${path.relative(ROOT, dir).split(path.sep).join('/')}/**/*`);
    if (!wantedNames.has(nameOf(dir))) excludes.add(`!node_modules/${nameOf(dir)}/**/*`);
  }
  console.log(`[dist] standard edition: keeping ${wanted.size} dependency packages, excluding ${excludes.size} unused`);
  return [...excludes];
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
    ...unusedDependencyExcludes(),
    '!src/main/torrents.js',
    '!src/main/grabber.js',
    '!src/pages/torrents.html',
    // Drop the entire BitTorrent stack (incl. the native utp-native transport)
    // so the clean edition carries no torrent code at all.
    '!node_modules/webtorrent/**/*',
    '!node_modules/utp-native/**/*',
    '!node_modules/bittorrent-*/**/*',
    '!node_modules/*-torrent*/**/*',
    '!node_modules/{ut_metadata,ut_pex,ut_hole_punch,lt_donthave}/**/*',
    '!node_modules/{k-rpc,k-rpc-socket}/**/*',
  ];
  // No native Node module ships in the standard edition (utp-native, bufferutil and
  // utf-8-validate are BitTorrent-only and excluded above), so skip electron-builder's
  // @electron/rebuild pass: it would compile them with node-gyp, which needs Python
  // and a C++ toolchain, only to throw the result away.
  config.npmRebuild = false;
}
config.linux.desktop = config.linux.desktop || { entry: {} };
config.linux.desktop.entry.Name = e.productName;
config.linux.desktop.entry.StartupWMClass = e.exe;

// Build for the host OS: Linux packages on Linux, an NSIS installer on Windows.
let targets;
if (wantAppx) {
  // Microsoft Store package. The Store identity lives in package.json > build.appx.
  // Name it after the Store listing so the executable, window title and
  // profile folder match what the user installed ("Flint Browser.exe").
  config.productName = 'Flint Browser';
  config.extraMetadata.productName = 'Flint Browser';
  // electron-builder pastes the description into AppxManifest.xml without XML
  // escaping, so the "&" in package.json's description makes the manifest invalid.
  config.extraMetadata.description = 'Fast, private, batteries-included web browser with built-in ad and tracker blocking, secure DNS, turbo downloads and reader mode.';
  targets = Platform.WINDOWS.createTarget(['appx']);
} else if (process.platform === 'win32') {
  targets = Platform.WINDOWS.createTarget(['nsis']);
} else if (process.platform === 'darwin') {
  targets = Platform.MAC.createTarget(['dmg', 'zip']);
} else {
  targets = Platform.LINUX.createTarget(['deb', 'AppImage', 'tar.gz']);
}

console.log(`\n=== Building ${e.productName} (${editionId}) for ${process.platform} ===\n`);

build({
  targets,
  config,
  publish: 'never', // the CI workflow uploads artifacts itself
}).then((files) => {
  console.log('\nArtifacts:');
  for (const f of files) if (/\.(deb|AppImage|tar\.gz|exe|appx)$/.test(f)) console.log('  ' + path.basename(f));
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
