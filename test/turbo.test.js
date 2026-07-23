'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { TurboDownload } = require('../src/main/turbo');

function makeServer(data, { ranges = true, throttle = 0 } = {}) {
  const stats = { rangeHits: 0, plainHits: 0 };
  const server = http.createServer((req, res) => {
    const range = ranges && req.headers.range;
    let start = 0;
    let end = data.length - 1;
    if (range) {
      stats.rangeHits++;
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      start = Number(m[1]);
      end = m[2] ? Number(m[2]) : data.length - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${data.length}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
      });
    } else {
      stats.plainHits++;
      res.writeHead(200, { 'Content-Length': data.length });
    }
    const body = data.subarray(start, end + 1);
    if (!throttle) return res.end(body);
    let off = 0;
    const chunk = 128 * 1024;
    const tick = () => {
      if (off >= body.length) return res.end();
      res.write(body.subarray(off, off + chunk));
      off += chunk;
      setTimeout(tick, throttle);
    };
    tick();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, stats, port: server.address().port }));
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-turbo-'));

test('segmented download is byte-identical', async () => {
  const data = crypto.randomBytes(9 * 1024 * 1024);
  const { server, stats, port } = await makeServer(data);
  const dest = path.join(tmp, 'seg.bin');
  const dl = new TurboDownload(`http://127.0.0.1:${port}/f`, dest, { segments: 4 });
  const state = await dl.start();
  server.close();
  assert.equal(state, 'done');
  assert.ok(fs.readFileSync(dest).equals(data), 'bytes differ');
  assert.ok(stats.rangeHits >= 4, `expected >=4 range requests, got ${stats.rangeHits}`);
});

test('server without range support falls back to single stream', async () => {
  const data = crypto.randomBytes(1024 * 1024);
  const { server, stats, port } = await makeServer(data, { ranges: false });
  const dest = path.join(tmp, 'plain.bin');
  const dl = new TurboDownload(`http://127.0.0.1:${port}/f`, dest, { segments: 6 });
  const state = await dl.start();
  server.close();
  assert.equal(state, 'done');
  assert.ok(fs.readFileSync(dest).equals(data));
  assert.ok(stats.rangeHits === 0 || stats.plainHits >= 1);
});

test('pause and resume completes with identical bytes', async () => {
  const data = crypto.randomBytes(9 * 1024 * 1024);
  const { server, port } = await makeServer(data, { throttle: 8 });
  const dest = path.join(tmp, 'resume.bin');

  const dl1 = new TurboDownload(`http://127.0.0.1:${port}/f`, dest, { segments: 4 });
  const paused = new Promise((resolve) => {
    dl1.once('progress', async () => { await dl1.pause(); resolve(); });
  });
  const run1 = dl1.start();
  await paused;
  await run1;
  assert.equal(dl1.state, 'paused');
  assert.ok(fs.existsSync(dest + '.flintdl'), 'resume metadata missing');

  const dl2 = new TurboDownload(`http://127.0.0.1:${port}/f`, dest, { segments: 4 });
  const state = await dl2.start();
  server.close();
  assert.equal(state, 'done');
  assert.ok(fs.readFileSync(dest).equals(data), 'bytes differ after resume');
  assert.ok(!fs.existsSync(dest + '.flintdl'), 'metadata not cleaned up');
});
