'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { isMagnet, describeSource } = require('../src/main/torrents');

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

test('describes a magnet for the confirmation prompt', () => {
  const d = describeSource('magnet:?xt=urn:btih:C12FE1C06BBA254A9DC9F519B335AA7C1367A88A&dn=Ubuntu+24.04%20ISO&tr=x');
  assert.strictEqual(d.kind, 'magnet');
  assert.strictEqual(d.name, 'Ubuntu 24.04 ISO');
  assert.strictEqual(d.detail, 'Info hash: c12fe1c06bba254a9dc9f519b335aa7c1367a88a');
});

test('describes a .torrent URL by file name and host', () => {
  const d = describeSource('https://files.example.com/isos/debian%2013.torrent?x=1');
  assert.deepStrictEqual(d, { kind: 'file', name: 'debian 13.torrent', detail: 'From: files.example.com' });
});

test('prompt text cannot be padded or carry control characters', () => {
  const long = 'A'.repeat(500);
  const d = describeSource(`magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=${long}%0A%0AClick%20Add`);
  assert.ok(d.name.length <= 120);
  assert.ok(!/[\u0000-\u001f]/.test(d.name));
  const bad = describeSource('magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=%E0%A4%A');
  assert.strictEqual(typeof bad.name, 'string');
  assert.strictEqual(describeSource('not a url').name, 'Torrent file');
  assert.strictEqual(describeSource(null).kind, 'file');
});
