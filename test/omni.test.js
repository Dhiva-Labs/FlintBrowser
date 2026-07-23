'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveOmniInput, searchUrl } = require('../src/main/omni');

test('bare domain resolves to https with fallback', () => {
  const r = resolveOmniInput('example.com', 'ddg');
  assert.equal(r.url, 'https://example.com');
  assert.equal(r.kind, 'url');
  assert.ok(r.httpsFallback);
});

test('domain with path and query stays a url', () => {
  const r = resolveOmniInput('sub.domain.co.uk/path?q=1', 'ddg');
  assert.equal(r.url, 'https://sub.domain.co.uk/path?q=1');
  assert.equal(r.kind, 'url');
});

test('plain words become a search', () => {
  const r = resolveOmniInput('hello world', 'ddg');
  assert.equal(r.kind, 'search');
  assert.ok(r.url.startsWith('https://duckduckgo.com/?q=hello%20world'));
});

test('single word without dot becomes a search', () => {
  const r = resolveOmniInput('intranethost', 'google');
  assert.equal(r.kind, 'search');
  assert.ok(r.url.includes('google.com/search'));
});

test('localhost with port is http url', () => {
  const r = resolveOmniInput('localhost:3000/admin', 'ddg');
  assert.equal(r.url, 'http://localhost:3000/admin');
  assert.equal(r.kind, 'url');
});

test('IPv4 address is http url', () => {
  const r = resolveOmniInput('192.168.1.1/settings', 'ddg');
  assert.equal(r.url, 'http://192.168.1.1/settings');
});

test('explicit https url passes through', () => {
  const r = resolveOmniInput('https://x.com/a?b=c', 'ddg');
  assert.equal(r.url, 'https://x.com/a?b=c');
  assert.equal(r.kind, 'url');
  assert.ok(!r.httpsFallback);
});

test('flint pages resolve internally', () => {
  assert.equal(resolveOmniInput('flint://settings', 'ddg').url, 'flint://settings');
  assert.equal(resolveOmniInput('flint:settings', 'ddg').url, 'flint://settings');
  assert.equal(resolveOmniInput('flint://settings', 'ddg').kind, 'internal');
});

test('question-like input is a search', () => {
  const r = resolveOmniInput('what is 2+2?', 'ddg');
  assert.equal(r.kind, 'search');
});

test('unknown scheme becomes search, mailto passes', () => {
  assert.equal(resolveOmniInput('foo://bar', 'ddg').kind, 'search');
  assert.equal(resolveOmniInput('mailto:a@b.c', 'ddg').kind, 'url');
});

test('empty input yields null', () => {
  assert.equal(resolveOmniInput('   ', 'ddg'), null);
});

test('searchUrl encodes query', () => {
  assert.ok(searchUrl('bing', 'a&b').includes('a%26b'));
});
