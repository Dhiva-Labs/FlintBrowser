'use strict';

// Smoke test: runs inside the app when started with --smoke.
// Exercises real navigation, adblock, stores, internal pages and the turbo
// downloader, saving screenshots as proof. Exits 0 on success.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = async function smoke(ctx) {
  const { app } = require('electron');
  const outDir = process.env.FLINT_SMOKE_OUT || path.join(os.tmpdir(), 'flint-smoke');
  fs.mkdirSync(outDir, { recursive: true });

  let failed = 0;
  let passed = 0;
  const t = async (name, fn) => {
    try {
      await fn();
      passed++;
      console.log('  PASS', name);
    } catch (err) {
      failed++;
      console.error('  FAIL', name, '—', err.message);
    }
  };

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitLoad = (wc, timeout = 30000) => new Promise((resolve, reject) => {
    if (!wc.isLoading()) return resolve();
    const to = setTimeout(() => reject(new Error('load timeout')), timeout);
    wc.once('did-stop-loading', () => { clearTimeout(to); resolve(); });
  });
  const shot = async (name, wc) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
  };

  console.log('[smoke] starting, edition:', ctx.edition.id, '— output:', outDir);
  const w = ctx.wm.create({});
  await settle(1500);

  await t('chrome UI loaded', async () => {
    await waitLoad(w.chromeView.webContents);
  });

  await t('navigate to example.com', async () => {
    const tab = w.tabs.active;
    tab.load('https://example.com');
    await settle(300);
    await waitLoad(tab.wc);
    await settle(500);
    const title = tab.wc.getTitle();
    if (!/example/i.test(title)) throw new Error('unexpected title: ' + title);
  });

  await t('adblock engine blocks known ad/tracker URLs', async () => {
    if (!ctx.blocker.ready) throw new Error('engine not loaded');
    const cases = [
      ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script'],
      ['https://www.googletagmanager.com/gtm.js?id=GTM-XXXX', 'script'],
      ['https://connect.facebook.net/en_US/fbevents.js', 'script'],
    ];
    for (const [url, type] of cases) {
      if (!ctx.blocker.wouldBlock(url, type, 'https://example.com/')) {
        throw new Error('not blocked: ' + url);
      }
    }
  });

  await t('history recorded the visit', async () => {
    const rows = ctx.stores.history.query('example', 10);
    if (!rows.some((r) => r.url.includes('example.com'))) throw new Error('no history entry');
  });

  await t('bookmarks roundtrip', async () => {
    ctx.stores.bookmarks.add('https://example.com/', 'Example Domain');
    if (!ctx.stores.bookmarks.has('https://example.com/')) throw new Error('add failed');
    ctx.stores.bookmarks.remove('https://example.com/');
    if (ctx.stores.bookmarks.has('https://example.com/')) throw new Error('remove failed');
  });

  await t('settings roundtrip', async () => {
    ctx.stores.settings.set({ searchEngine: 'brave' });
    if (ctx.stores.settings.get().searchEngine !== 'brave') throw new Error('set failed');
    ctx.stores.settings.set({ searchEngine: 'ddg' });
  });

  await t('screenshots: example.com', async () => {
    await shot('content-example.png', w.tabs.active.wc);
    await shot('chrome-1.png', w.chromeView.webContents);
  });

  await t('internal pages load (settings, home)', async () => {
    const tabS = w.tabs.create('flint://settings');
    await settle(300);
    await waitLoad(tabS.wc);
    await settle(500);
    await shot('content-settings.png', tabS.wc);
    const tabH = w.tabs.create('flint://home');
    await settle(300);
    await waitLoad(tabH.wc);
    await settle(500);
    await shot('content-home.png', tabH.wc);
    await shot('chrome-3tabs.png', w.chromeView.webContents);
  });

  await t('turbo download: segmented, byte-identical', async () => {
    const data = crypto.randomBytes(12 * 1024 * 1024);
    let rangeHits = 0;
    const server = http.createServer((req, res) => {
      const range = req.headers.range;
      if (range) {
        rangeHits++;
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : data.length - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'application/octet-stream',
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes' });
        res.end(data);
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const dest = path.join(outDir, 'turbo-test.bin');
    try { fs.unlinkSync(dest); } catch { /* fresh */ }
    const { TurboDownload } = require('../src/main/turbo');
    const dl = new TurboDownload(`http://127.0.0.1:${port}/file.bin`, dest, { segments: 6 });
    const state = await dl.start();
    server.close();
    if (state !== 'done') throw new Error('final state: ' + state + (dl.error ? ' (' + dl.error + ')' : ''));
    const got = fs.readFileSync(dest);
    if (!got.equals(data)) throw new Error('bytes differ');
    if (rangeHits < 4) throw new Error('not segmented enough, range hits=' + rangeHits);
    fs.unlinkSync(dest);
  });

  await t('DoH configuration applies', async () => {
    if (!ctx.doh.apply(app, { mode: 'secure', provider: 'cloudflare' })) throw new Error('apply failed');
    ctx.doh.apply(app, ctx.stores.settings.get().doh);
  });

  // ---- Flint Plus features ----
  if (ctx.edition.features.mediaGrabber) {
    await t('grabber sniffs a direct media file', async () => {
      const media = crypto.randomBytes(200 * 1024);
      const server = http.createServer((req, res) => {
        if (req.url === '/clip.mp4') {
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': media.length });
          res.end(media);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!doctype html><meta charset=utf8><body>media page<script>fetch("/clip.mp4")</script>');
        }
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      const tab = w.tabs.create(`http://127.0.0.1:${port}/`);
      await settle(400);
      await waitLoad(tab.wc);
      await settle(1200);
      server.close();
      const found = ctx.grabber.list(tab.id);
      if (!found.some((m) => m.url.endsWith('/clip.mp4') && m.kind === 'video')) {
        throw new Error('media not detected: ' + JSON.stringify(found));
      }
    });

    await t('grabber refuses blocklisted streaming services', async () => {
      const { classify } = require('../src/main/grabber');
      if (classify('https://rr3---sn-abc.googlevideo.com/videoplayback?x=1', 'video/mp4', 5e6) !== null) {
        throw new Error('googlevideo should be blocklisted');
      }
      if (classify('https://cdn.example.com/movie.mp4', 'video/mp4', 5e6) === null) {
        throw new Error('plain direct mp4 should be grabbable');
      }
    });
  } else {
    await t('standard edition has no media grabber', async () => {
      if (ctx.grabber) throw new Error('grabber should not exist in standard edition');
    });
  }

  if (ctx.edition.features.torrents) {
    await t('torrent client transfers over a loopback tracker', async () => {
      const { Server } = require('bittorrent-tracker');
      const WebTorrent = require('webtorrent');
      const tracker = new Server({ udp: false, ws: false, http: true, stats: false });
      await new Promise((r) => tracker.listen(0, '127.0.0.1', r));
      const announce = `http://127.0.0.1:${tracker.http.address().port}/announce`;
      const data = crypto.randomBytes(512 * 1024);
      const leechDir = path.join(outDir, 'torrent-leech');
      fs.mkdirSync(leechDir, { recursive: true });
      const leech = new WebTorrent({ dht: false, lsd: false });

      try {
        await new Promise((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('transfer timed out')), 40000);
          ctx.torrents.seed(data, { name: 'flint-selftest.bin', announce: [announce] }, (err, seeded) => {
            if (err) { clearTimeout(to); return reject(err); }
            leech.add(seeded.torrentFile, { path: leechDir, announce: [announce] }, (lt) => {
              lt.on('error', (e) => { clearTimeout(to); reject(e); });
              lt.on('done', () => {
                clearTimeout(to);
                try {
                  const got = fs.readFileSync(path.join(lt.path, lt.files[0].path));
                  if (!got.equals(data)) return reject(new Error('bytes differ after transfer'));
                  resolve();
                } catch (e) { reject(e); }
              });
            });
          });
        });
      } finally {
        await new Promise((r) => leech.destroy(r));
        await new Promise((r) => tracker.close(r));
      }
    });

    await t('flint://torrents page loads', async () => {
      const tt = w.tabs.create('flint://torrents');
      await settle(300);
      await waitLoad(tt.wc);
      await settle(500);
      await shot('content-torrents.png', tt.wc);
    });
  } else {
    await t('standard edition has no torrent engine', async () => {
      if (ctx.torrents) throw new Error('torrents should not exist in standard edition');
    });
  }

  console.log(`[smoke] done: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
};
