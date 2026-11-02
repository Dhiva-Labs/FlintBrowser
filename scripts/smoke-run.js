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

  await t('cosmetic blocking hides ad elements, in iframes too', async () => {
    // uBlock exempts localhost/127.0.0.1 from element hiding, so serve the
    // test page under a public-looking (reserved .example) hostname.
    const host = 'cosmetic.flint.example';
    const frame = '<div id="ad_banner">ad</div><div id="ok">content</div>';
    const page = `<div id="ok">content</div><iframe src="http://${host}/frame"></iframe>
      <script>setTimeout(() => { const d = document.createElement('div'); d.className = 'sponsored-post'; d.textContent = 'ad'; document.body.appendChild(d); }, 300);</script>`;
    const ses = w.tabs.active.wc.session;
    const { net } = require('electron');
    ses.protocol.handle('http', (req) => {
      const u = new URL(req.url);
      if (u.hostname !== host) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      // The ad element is added after load, so the DOM watcher has to find it.
      return new Response(u.pathname === '/frame' ? frame : page, { headers: { 'content-type': 'text/html' } });
    });
    try {
      const tab = w.tabs.create(`http://${host}/`);
      await settle(300);
      await waitLoad(tab.wc);
      await settle(1200);
      const top = await tab.wc.executeJavaScript(`({
        ad: getComputedStyle(document.querySelector('.sponsored-post')).display,
        ok: getComputedStyle(document.getElementById('ok')).display,
        bridge: typeof window.flintPages,
      })`);
      if (top.ad !== 'none') throw new Error('late-added ad element still visible');
      if (top.ok === 'none') throw new Error('content element hidden');
      if (top.bridge !== 'undefined') throw new Error('internal-pages bridge exposed to a web page');
      const sub = tab.wc.mainFrame.frames[0];
      const inFrame = await sub.executeJavaScript(`getComputedStyle(document.getElementById('ad_banner')).display`);
      if (inFrame !== 'none') throw new Error('ad element in iframe still visible');
      w.tabs.close(tab.id);
    } finally {
      ses.protocol.unhandle('http');
    }
  });

  await t('redirect rules serve stand-ins instead of failing the request', async () => {
    // YouTube's ad_status.js check and gpt.js/analytics.js callers expect the
    // neutered resource to load; a failed request breaks pages or flags the
    // blocker.
    const host = 'stubs.flint.example';
    const page = `<script>
      window.results = {};
      const s = document.createElement('script');
      s.src = 'https://static.doubleclick.net/instream/ad_status.js';
      s.onload = () => { window.results.script = 'loaded:' + window.google_ad_status; };
      s.onerror = () => { window.results.script = 'error'; };
      document.head.appendChild(s);
      fetch('https://googleads.g.doubleclick.net/pagead/id', { credentials: 'include' })
        .then((r) => r.text().then((t) => { window.results.xhr = r.status + ':' + t.length; }))
        .catch((e) => { window.results.xhr = 'error:' + e.message; });
    </script>`;
    const ses = w.tabs.active.wc.session;
    const { net } = require('electron');
    ses.protocol.handle('http', (req) => {
      if (new URL(req.url).hostname !== host) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      return new Response(page, { headers: { 'content-type': 'text/html', 'content-security-policy': "script-src 'unsafe-inline' https:; connect-src https:" } });
    });
    try {
      const tab = w.tabs.create(`http://${host}/`);
      await settle(300);
      await waitLoad(tab.wc);
      await settle(800);
      const r = await tab.wc.executeJavaScript('window.results');
      if (r.script !== 'loaded:1') throw new Error('ad_status.js stand-in: ' + r.script);
      if (r.xhr !== '200:0') throw new Error('pagead/id stand-in: ' + r.xhr);
      w.tabs.close(tab.id);
    } finally {
      ses.protocol.unhandle('http');
    }
  });

  await t('clearing one site removes its cookies and keeps other sites', async () => {
    const { clearSiteData } = require('../src/main/sitedata');
    const ses = w.tabs.active.wc.session;
    await ses.cookies.set({ url: 'https://a.reset.flint.example/', name: 'host_only', value: '1' });
    await ses.cookies.set({ url: 'https://reset.flint.example/', domain: '.reset.flint.example', name: 'whole_site', value: '1', secure: true });
    await ses.cookies.set({ url: 'https://keep.flint-other.example/', name: 'keep', value: '1' });
    const site = await clearSiteData(ses, 'https://a.reset.flint.example/watch?v=1');
    if (site !== 'flint.example' && site !== 'reset.flint.example') throw new Error('unexpected site: ' + site);
    const left = (await ses.cookies.get({})).map((c) => c.name);
    if (left.includes('host_only') || left.includes('whole_site')) throw new Error('site cookies survived: ' + left);
    if (!left.includes('keep')) throw new Error('another site lost its cookie');
    if (await clearSiteData(ses, 'flint://settings') !== null) throw new Error('cleared an internal page');
    await ses.cookies.remove('https://keep.flint-other.example/', 'keep');
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

    // Close the app's own torrent client (and its uTP socket) before the process
    // exits. Left open, app.exit() ended in a segfault on Windows (x64, arm64)
    // and Linux arm64 even though every test above had passed.
    await t('torrent client shuts down', async () => {
      if (ctx.torrents.client) await new Promise((r) => ctx.torrents.destroy(r));
    });
  } else {
    await t('standard edition has no torrent engine', async () => {
      if (ctx.torrents) throw new Error('torrents should not exist in standard edition');
    });
  }

  console.log(`[smoke] done: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
};
