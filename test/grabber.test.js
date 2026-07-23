'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { classify, hostBlocked } = require('../src/main/grabber');

test('plain direct mp4 is grabbable', () => {
  const r = classify('https://cdn.example.com/videos/lecture.mp4', 'video/mp4', 5_000_000);
  assert.ok(r);
  assert.equal(r.kind, 'video');
  assert.equal(r.name, 'lecture.mp4');
});

test('direct mp3 is grabbable audio', () => {
  const r = classify('https://files.example.org/song.mp3', 'audio/mpeg', 4_000_000);
  assert.ok(r);
  assert.equal(r.kind, 'audio');
});

test('HLS playlist is grabbable even when tiny', () => {
  const r = classify('https://v.example.com/master.m3u8', 'application/vnd.apple.mpegurl', 800);
  assert.ok(r);
  assert.equal(r.kind, 'hls');
});

test('classification works by extension when content-type is generic', () => {
  const r = classify('https://cdn.example.com/clip.webm', 'application/octet-stream', 3_000_000);
  assert.ok(r);
  assert.equal(r.kind, 'video');
});

test('YouTube / googlevideo is never grabbable', () => {
  assert.equal(classify('https://rr1---sn-x.googlevideo.com/videoplayback?a=1', 'video/mp4', 9_000_000), null);
  assert.equal(classify('https://www.youtube.com/watch?v=x', 'text/html', 0), null);
});

test('major DRM streamers are blocklisted', () => {
  assert.ok(hostBlocked('occ-0-1.nflxvideo.net'));
  assert.ok(hostBlocked('spclient.wg.spotify.com'));
  assert.ok(hostBlocked('vod.disney-plus.net'));
  assert.ok(!hostBlocked('cdn.example.com'));
});

test('DASH manifests (DRM-prone) are refused', () => {
  assert.equal(classify('https://cdn.example.com/stream.mpd', 'application/dash+xml', 2000), null);
});

test('streaming segments are ignored', () => {
  assert.equal(classify('https://cdn.example.com/seg-00042.ts', 'video/mp2t', 500_000), null);
  assert.equal(classify('https://cdn.example.com/chunk_1.m4s', 'video/iso.segment', 500_000), null);
});

test('tiny direct files (thumbnails) are ignored', () => {
  assert.equal(classify('https://cdn.example.com/preview.mp4', 'video/mp4', 20_000), null);
});
