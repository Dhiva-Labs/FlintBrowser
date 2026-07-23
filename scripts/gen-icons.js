'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');
const outDir = path.join(buildDir, 'icons');
const SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    await sharp(svgPath, { density: size >= 512 ? 300 : 96 })
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `${size}x${size}.png`));
  }
  fs.copyFileSync(path.join(outDir, '512x512.png'), path.join(buildDir, 'icon.png'));

  // Windows .ico (multi-resolution) for electron-builder's nsis target.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256].map((s) => path.join(outDir, `${s}x${s}.png`));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), await pngToIco(icoSizes));

  console.log('[icons] generated', SIZES.length, 'PNG sizes + icon.ico');
})().catch((err) => { console.error(err); process.exit(1); });
