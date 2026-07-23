'use strict';

// Edition system. Two products are built from this one codebase:
//   - standard ("Flint")      : clean, store-safe. No torrents, no grabber.
//   - plus     ("Flint Plus") : adds a BitTorrent client and media grabber.
//
// Packaged builds carry a generated marker (src/edition-config.json, written by
// scripts/dist.js). During development the FLINT_EDITION env var selects the
// edition; with neither present we fall back to the safe 'standard' edition.

const fs = require('fs');
const path = require('path');

const EDITIONS = {
  standard: {
    id: 'standard',
    productName: 'Flint',
    features: { torrents: false, mediaGrabber: false },
  },
  plus: {
    id: 'plus',
    productName: 'Flint Plus',
    features: { torrents: true, mediaGrabber: true },
  },
};

function resolve() {
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'edition-config.json'), 'utf8')).edition;
  } catch { /* not a packaged/edition build */ }
  const id = process.env.FLINT_EDITION || marker || 'standard';
  return EDITIONS[id] || EDITIONS.standard;
}

const edition = resolve();

module.exports = { edition, EDITIONS };
