'use strict';

// Generate the Microsoft Store / MSIX tile assets into build/appx/ from
// build/icon.svg. electron-builder picks that folder up for the appx target
// (see build.appx in package.json) and, because scaled files are present,
// builds a resources.pri so Windows can choose the right size per display.
//
//   npm run build:appx-assets
//
// The generated PNGs are committed, so a Windows build does not need to run
// this. Re-run it after changing build/icon.svg.
//
// Layout of each asset:
//   - Square44x44Logo / StoreLogo: the rounded app icon on a transparent
//     background (the taskbar, Start list and Store listing draw their own plate).
//   - Square150x150Logo / SmallTile / LargeTile / Wide310x150Logo: opaque
//     full-bleed tiles in the icon's own gradient with the flame centred.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const buildDir = path.join(__dirname, '..', 'build');
const outDir = path.join(buildDir, 'appx');
const svgSrc = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');

// Pieces of icon.svg: shared gradient defs and the two flame paths.
const defs = svgSrc.match(/<defs>[\s\S]*?<\/defs>/)[0];
const flame = svgSrc.match(/<path [\s\S]*?\/>/g).join('\n');
const FLAME_TOP = 74;
const FLAME_BOTTOM = 390;
const FLAME_CENTRE_X = 256;

// The Start tile background colour set in package.json (appx.backgroundColor)
// is the mid-point of the icon gradient so scaled-down plates blend in.
const SCALES = [100, 125, 150, 200, 400];

function roundedIcon(size) {
  return svgSrc.replace('<svg ', `<svg width="${size}" height="${size}" `);
}

// Full-bleed tile of w x h with the flame scaled to `fill` of the height.
function tile(w, h, fill) {
  const k = (fill * h) / (FLAME_BOTTOM - FLAME_TOP);
  const tx = w / 2 - FLAME_CENTRE_X * k;
  const ty = h / 2 - ((FLAME_TOP + FLAME_BOTTOM) / 2) * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs}
  <radialGradient id="tileGlow" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${h * 0.62}" r="${h * 0.6}">
    <stop offset="0" stop-color="#ff8a3d" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/>
  </radialGradient>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#tileGlow)"/>
  <g transform="translate(${tx} ${ty}) scale(${k})">${flame}</g>
</svg>`;
}

// [file stem, base width, base height, svg builder(w, h)]
const ASSETS = [
  ['StoreLogo', 50, 50, (w) => roundedIcon(w)],
  ['Square44x44Logo', 44, 44, (w) => roundedIcon(w)],
  ['Square150x150Logo', 150, 150, (w, h) => tile(w, h, 0.62)],
  ['Wide310x150Logo', 310, 150, (w, h) => tile(w, h, 0.66)],
  ['LargeTile', 310, 310, (w, h) => tile(w, h, 0.62)],
  ['SmallTile', 71, 71, (w, h) => tile(w, h, 0.66)],
];

// Taskbar / title-bar / alt-tab sizes for the 44x44 logo (plated and unplated).
const TARGET_SIZES = [16, 24, 32, 48, 256];

async function write(name, w, h, svg) {
  await sharp(Buffer.from(svg(w, h)), { density: 72 })
    .resize(w, h)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, name));
}

(async () => {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let count = 0;

  for (const [stem, bw, bh, svg] of ASSETS) {
    await write(`${stem}.png`, bw, bh, svg);
    count++;
    for (const s of SCALES) {
      await write(`${stem}.scale-${s}.png`, Math.round((bw * s) / 100), Math.round((bh * s) / 100), svg);
      count++;
    }
  }
  for (const size of TARGET_SIZES) {
    const svg = ASSETS.find((a) => a[0] === 'Square44x44Logo')[3];
    await write(`Square44x44Logo.targetsize-${size}.png`, size, size, svg);
    await write(`Square44x44Logo.targetsize-${size}_altform-unplated.png`, size, size, svg);
    count += 2;
  }

  console.log(`[appx-assets] generated ${count} PNGs in ${path.relative(process.cwd(), outDir)}`);
})().catch((err) => { console.error(err); process.exit(1); });
