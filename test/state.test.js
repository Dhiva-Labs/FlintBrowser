'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore, HistoryStore, BookmarkStore } = require('../src/main/state');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-state-'));

test('JsonStore persists and reloads with defaults merged', () => {
  const file = path.join(tmp, 's.json');
  const a = new JsonStore(file, { x: 1, nested: { y: 2, z: 3 } });
  a.set({ nested: { y: 9 } });
  a.flush();
  const b = new JsonStore(file, { x: 1, nested: { y: 2, z: 3 }, added: 'later' });
  assert.equal(b.get().nested.y, 9);
  assert.equal(b.get().nested.z, 3);
  assert.equal(b.get().added, 'later');
});

test('HistoryStore records, queries, suggests and clears', () => {
  const h = new HistoryStore(path.join(tmp, 'h.json'));
  h.record('https://example.com/', 'Example Domain');
  h.record('https://example.com/', 'Example Domain');
  h.record('https://github.com/Dhiva-Labs', 'Dhiva Labs');
  h.record('flint://settings', 'ignored'); // non-http ignored

  const q = h.query('example');
  assert.equal(q.length, 1);
  assert.equal(q[0].visits, 2);

  const s = h.suggest('exam');
  assert.ok(s.length >= 1);
  assert.equal(s[0].url, 'https://example.com/');

  const top = h.topSites(5);
  assert.ok(top.length === 2);

  h.remove('https://example.com/');
  assert.equal(h.query('example').length, 0);
  h.clear();
  assert.equal(h.query('').length, 0);
});

test('BookmarkStore toggles', () => {
  const b = new BookmarkStore(path.join(tmp, 'b.json'));
  assert.equal(b.toggle('https://a.com/', 'A'), true);
  assert.ok(b.has('https://a.com/'));
  assert.equal(b.toggle('https://a.com/', 'A'), false);
  assert.ok(!b.has('https://a.com/'));
});
