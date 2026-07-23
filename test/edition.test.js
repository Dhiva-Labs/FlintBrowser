'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

function loadEdition(envValue) {
  delete require.cache[require.resolve('../src/main/edition')];
  const prev = process.env.FLINT_EDITION;
  if (envValue === undefined) delete process.env.FLINT_EDITION;
  else process.env.FLINT_EDITION = envValue;
  try {
    return require('../src/main/edition');
  } finally {
    if (prev === undefined) delete process.env.FLINT_EDITION;
    else process.env.FLINT_EDITION = prev;
  }
}

test('standard edition disables torrents and grabber', () => {
  const { edition } = loadEdition('standard');
  assert.equal(edition.id, 'standard');
  assert.equal(edition.features.torrents, false);
  assert.equal(edition.features.mediaGrabber, false);
});

test('plus edition enables torrents and grabber', () => {
  const { edition } = loadEdition('plus');
  assert.equal(edition.id, 'plus');
  assert.equal(edition.features.torrents, true);
  assert.equal(edition.features.mediaGrabber, true);
});

test('unknown edition falls back to standard (safe default)', () => {
  const { edition } = loadEdition('bogus');
  assert.equal(edition.id, 'standard');
});
