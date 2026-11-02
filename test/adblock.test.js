'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { AdBlocker } = require('../src/main/adblock');
const youtube = require('../src/main/youtube');

const ENGINE = path.join(__dirname, '..', 'build', 'adblock-engine.bin');

function blocker(settings = {}) {
  const s = { adblockEnabled: true, adblockAllowlist: [], ...settings };
  const b = new AdBlocker({ get: () => s, set: (p) => Object.assign(s, p) });
  assert.ok(b.load(ENGINE), 'engine loads');
  return b;
}

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('YouTube gets the ad-stripping scriptlets plus the built-in fallback', () => {
  const c = blocker().cosmetics(WATCH, WATCH);
  assert.ok(c, 'payload for youtube');
  assert.ok(c.scripts.length > 5, `expected uBlock scriptlets, got ${c.scripts.length}`);
  assert.ok(c.scripts.some((s) => s.includes('adPlacements')), 'a scriptlet prunes adPlacements');
  assert.ok(c.scripts.includes(youtube.SCRIPT), 'fallback skipper included');
  assert.match(c.styles, /ytd-ad-slot-renderer/);
});

test('every injected script compiles on its own scope', () => {
  // Scriptlets repeat top-level helpers (class JSONPath, proxyApplyFn, ...);
  // each must stay compilable and self-contained once wrapped.
  for (const code of blocker().cosmetics(WATCH, WATCH).scripts) {
    assert.doesNotThrow(() => new Function(code));
  }
});

test('ordinary sites get the generic base stylesheet but no scriptlets', () => {
  const c = blocker().cosmetics('https://example.com/', 'https://example.com/');
  assert.ok(c);
  assert.equal(c.scripts.length, 0);
  assert.ok(c.styles.length > 0);
});

test('generic hiding rules follow class and id names from the DOM', () => {
  const css = blocker().domStyles('https://example.com/', 'https://example.com/', {
    classes: ['sponsored-post', 'article-body'],
    ids: ['ad_banner', 'main'],
  });
  assert.match(css, /\.sponsored-post/);
  assert.match(css, /#ad_banner/);
  assert.doesNotMatch(css, /article-body|#main\b/);
});

test('no cosmetics when blocking is off, allowlisted, or not a web page', () => {
  assert.equal(blocker({ adblockEnabled: false }).cosmetics(WATCH, WATCH), null);
  assert.equal(blocker({ adblockAllowlist: ['youtube.com'] }).cosmetics(WATCH, WATCH), null);
  // An iframe inherits its top-level page's allowlisting.
  assert.equal(blocker({ adblockAllowlist: ['example.com'] }).cosmetics(WATCH, 'https://example.com/'), null);
  assert.equal(blocker().cosmetics('flint://home', 'flint://home'), null);
  assert.equal(blocker({ adblockEnabled: false }).domStyles('https://example.com/', 'https://example.com/', { ids: ['ad_banner'] }), '');
});

test('youtube host matching covers subdomains and embeds only', () => {
  for (const h of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com']) {
    assert.ok(youtube.matches(h), h);
  }
  for (const h of ['notyoutube.com', 'youtube.com.evil.example', 'example.com', '']) {
    assert.ok(!youtube.matches(h), h);
  }
});

test('redirect stand-ins are served from flint-res:// with their real bytes', () => {
  const b = blocker();
  const js = b.stubUrl('data:application/javascript,window.google_ad_status%20%3D%201%3B');
  assert.equal(js, b.stubUrl('data:application/javascript,window.google_ad_status%20%3D%201%3B'), 'stable id');
  assert.match(js, /^flint-res:\/\/stub\/\d+$/);
  const gif = b.stubUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
  assert.notEqual(gif, js);
  assert.equal(b.stubUrl('not a data url'), null);

  const { decodeDataUrl } = require('../src/main/adblock');
  assert.equal(decodeDataUrl('data:application/javascript,window.google_ad_status%20%3D%201%3B').body.toString(), 'window.google_ad_status = 1;');
  const g = decodeDataUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
  assert.equal(g.contentType, 'image/gif');
  assert.equal(g.body.subarray(0, 6).toString(), 'GIF89a');
});
