'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '..', 'build', 'icon.svg');
const outDir = path.join(__dirname, '..', 'build', 'icons');
const SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    await sharp(svgPath, { density: size >= 512 ? 300 : 96 })
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `${size}x${size}.png`));
  }
  fs.copyFileSync(path.join(outDir, '512x512.png'), path.join(__dirname, '..', 'build', 'icon.png'));
  console.log('[icons] generated', SIZES.length, 'sizes');
})().catch((err) => { console.error(err); process.exit(1); });
