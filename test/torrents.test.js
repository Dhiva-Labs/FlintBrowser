'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { isMagnet } = require('../src/main/torrents');

test('recognises valid magnet URIs', () => {
  assert.ok(isMagnet('magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=x'));
  assert.ok(isMagnet('  magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01  '));
});

test('rejects non-magnets', () => {
  assert.ok(!isMagnet('https://example.com/file.torrent'));
  assert.ok(!isMagnet('magnet:?dn=noinfohash'));
  assert.ok(!isMagnet(''));
  assert.ok(!isMagnet(null));
});
