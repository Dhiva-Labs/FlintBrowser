'use strict';

// All IPC between the chrome UI / internal pages and the main process.
// Chrome channels are only honoured for registered chrome views; page
// channels are only honoured for flint:// senders.

const { ipcMain, app, dialog, nativeTheme } = require('electron');
const { resolveOmniInput, SEARCH_ENGINES } = require('./omni');
const { PROVIDERS } = require('./doh');

function registerIpc(ctx) {
  const { wm, stores, blocker, dl, menus, reader, doh } = ctx;

  const chromeWin = (event) => wm.byChromeWebContents(event.sender);
  const requireChrome = (event) => {
    const w = chromeWin(event);
    if (!w) throw new Error('not a chrome sender');
    return w;
  };
  const requirePages = (event) => {
    const url = (event.senderFrame && event.senderFrame.url) || '';
    if (!url.startsWith('flint://')) throw new Error('not an internal page');
    return url;
  };

  // ---------- chrome UI ----------

  ipcMain.on('omni:resolve', (event, text) => {
    const w = requireChrome(event);
    const resolved = resolveOmniInput(text, stores.settings.get().searchEngine);
    if (!resolved) return;
    const tab = w.tabs.active || w.tabs.create();
    tab.load(resolved.url, { httpsFallback: !!resolved.httpsFallback });
    tab.wc.focus();
  });

  ipcMain.handle('omni:suggest', (event, text) => {
    requireChrome(event);
    const s = stores.settings.get();
    const engineName = (SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.ddg).name;
    const resolved = resolveOmniInput(text, s.searchEngine);
    const rows = [];
    if (!resolved) return rows;
    if (resolved.kind === 'search') {
      rows.push({ type: 'search', text: `Search ${engineName} for “${text.trim()}”`, url: resolved.url });
    } else {
      rows.push({ type: 'url', text: resolved.url, url: resolved.url, fallback: !!resolved.httpsFallback });
    }
    for (const h of stores.history.suggest(text, 5)) {
      rows.push({ type: 'history', text: h.title, detail: h.url, url: h.url });
    }
    for (const b of stores.bookmarks.suggest(text, 3)) {
      if (!rows.some((r) => r.url === b.url)) {
        rows.push({ type: 'bookmark', text: b.title, detail: b.url, url: b.url });
      }
    }
    if (resolved.kind !== 'search') {
      rows.push({ type: 'search', text: `Search ${engineName} for “${text.trim()}”`, url: null, query: text.trim() });
    }
    return rows.slice(0, 9);
  });

  ipcMain.on('omni:navigate', (event, url) => {
    const w = requireChrome(event);
    const tab = w.tabs.active || w.tabs.create();
    tab.load(url);
    tab.wc.focus();
  });

  ipcMain.on('tabs:new', (event, url) => {
    const w = requireChrome(event);
    w.tabs.create(url || 'flint://home');
    if (!url) w.focusOmni();
  });
  ipcMain.on('tabs:close', (event, id) => requireChrome(event).tabs.close(id));
  ipcMain.on('tabs:activate', (event, id) => requireChrome(event).tabs.activate(id));
  ipcMain.on('tabs:reopen', (event) => requireChrome(event).tabs.reopen());

  ipcMain.on('nav:go', (event, dir) => {
    const w = requireChrome(event);
    const t = w.tabs.active;
    if (!t) return;
    try {
      if (dir === 'back') t.wc.navigationHistory.goBack();
      else if (dir === 'forward') t.wc.navigationHistory.goForward();
      else if (dir === 'reload') t.wc.reload();
      else if (dir === 'stop') t.wc.stop();
      else if (dir === 'home') t.load('flint://home');
    } catch { /* no history */ }
  });

  ipcMain.handle('tab:star', (event) => {
    const w = requireChrome(event);
    const t = w.tabs.active;
    if (!t) return false;
    const url = t.wc.getURL();
    if (!/^https?:/.test(url)) return false;
    const starred = stores.bookmarks.toggle(url, t.wc.getTitle());
    w.tabs.sync();
    return starred;
  });

  ipcMain.handle('shield:info', (event) => {
    const w = requireChrome(event);
    const t = w.tabs.active;
    let host = '';
    try { host = new URL(t ? t.wc.getURL() : '').hostname; } catch { /* internal page */ }
    return {
      enabled: stores.settings.get().adblockEnabled && blocker.ready,
      host,
      siteAllowed: blocker.isSiteAllowlisted(host),
      count: t ? t.blocked : 0,
    };
  });

  ipcMain.handle('shield:toggle-site', (event) => {
    const w = requireChrome(event);
    const t = w.tabs.active;
    let host = '';
    try { host = new URL(t ? t.wc.getURL() : '').hostname; } catch { return null; }
    if (!host) return null;
    const nowAllowed = blocker.toggleSite(host);
    if (t) t.wc.reload();
    return nowAllowed;
  });

  ipcMain.on('find:start', (event, { text, forward, first }) => {
    const w = requireChrome(event);
    const t = w.tabs.active;
    if (t && text) t.wc.findInPage(text, { forward: forward !== false, findNext: !!first });
  });
  ipcMain.on('find:stop', (event, keep) => {
    const w = requireChrome(event);
    const t = w.tabs.active;
    if (t) t.wc.stopFindInPage(keep ? 'keepSelection' : 'clearSelection');
    if (t) t.wc.focus();
  });

  ipcMain.on('chrome:overlay', (event, px) => requireChrome(event).setOverlay(px));

  ipcMain.on('win:ctl', (event, op) => {
    const w = requireChrome(event);
    if (op === 'min') w.win.minimize();
    else if (op === 'max') w.win.isMaximized() ? w.win.unmaximize() : w.win.maximize();
    else if (op === 'close') w.win.close();
  });

  ipcMain.on('menu:popup', (event) => menus.hamburgerMenu(requireChrome(event)));
  ipcMain.on('downloads:open', (event) => requireChrome(event).tabs.create('flint://downloads'));
  ipcMain.on('grabber:popup', (event) => menus.grabberMenu(requireChrome(event)));

  ipcMain.handle('grabber:count', (event) => {
    const w = requireChrome(event);
    const t = w.tabs.active;
    return ctx.grabber && t ? ctx.grabber.count(t.id) : 0;
  });

  // ---------- internal pages ----------

  ipcMain.handle('pages:boot', (event) => {
    requirePages(event);
    const s = stores.settings.get();
    return {
      settings: s,
      searchEngines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name })),
      dohProviders: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name })),
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
      adblockReady: blocker.ready,
      downloadDir: dl.dir(),
      edition: ctx.edition.id,
      productName: ctx.edition.productName,
      features: ctx.edition.features,
    };
  });

  ipcMain.handle('pages:set-settings', (event, patch) => {
    requirePages(event);
    if (!patch || typeof patch !== 'object') return stores.settings.get();
    const allowed = ['searchEngine', 'theme', 'adblockEnabled', 'adblockAllowlist', 'doh', 'httpsOnly', 'turboSegments', 'restoreSession'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    const s = stores.settings.set(clean);
    if ('doh' in clean) doh.apply(app, s.doh);
    if ('theme' in clean) nativeTheme.themeSource = s.theme === 'system' ? 'system' : s.theme;
    return s;
  });

  ipcMain.handle('pages:history', (event, q) => { requirePages(event); return stores.history.query(q, 300); });
  ipcMain.handle('pages:history-delete', (event, url) => { requirePages(event); stores.history.remove(url); return true; });
  ipcMain.handle('pages:history-clear', (event) => { requirePages(event); stores.history.clear(); return true; });

  ipcMain.handle('pages:bookmarks', (event) => { requirePages(event); return stores.bookmarks.list(); });
  ipcMain.handle('pages:bookmark-delete', (event, idOrUrl) => { requirePages(event); return stores.bookmarks.remove(idOrUrl); });

  ipcMain.handle('pages:downloads', (event) => { requirePages(event); return dl.list(); });
  ipcMain.handle('pages:download-action', (event, { id, action }) => { requirePages(event); return dl.action(id, action); });
  ipcMain.handle('pages:downloads-clear', (event) => { requirePages(event); dl.clearFinished(); return true; });

  ipcMain.handle('pages:top-sites', (event) => { requirePages(event); return stores.history.topSites(12); });

  ipcMain.handle('pages:torrents', (event) => {
    requirePages(event);
    if (!ctx.torrents) return { available: false, torrents: [] };
    return { available: ctx.torrents.available, error: ctx.torrents.error, torrents: ctx.torrents.list() };
  });
  ipcMain.handle('pages:torrent-add', (event, source) => {
    requirePages(event);
    if (!ctx.torrents) return { ok: false, error: 'Not available in this edition' };
    return ctx.torrents.add(source);
  });
  ipcMain.handle('pages:torrent-action', (event, { infoHash, action }) => {
    requirePages(event);
    return ctx.torrents ? ctx.torrents.action(infoHash, action) : false;
  });

  ipcMain.handle('pages:navigate', (event, input) => {
    requirePages(event);
    const resolved = typeof input === 'string' && /^(https?|flint):/i.test(input)
      ? { url: input }
      : resolveOmniInput(String(input || ''), stores.settings.get().searchEngine);
    if (resolved) event.sender.loadURL(resolved.url).catch(() => { });
    return true;
  });

  ipcMain.handle('pages:reader-get', (event, id) => { requirePages(event); return reader.get(id); });

  ipcMain.handle('pages:set-default', async (event) => {
    requirePages(event);
    const a = app.setAsDefaultProtocolClient('http');
    const b = app.setAsDefaultProtocolClient('https');
    return a && b;
  });

  ipcMain.handle('pages:clear-data', async (event, what) => {
    requirePages(event);
    const ses = event.sender.session;
    if (what.cache) await ses.clearCache();
    if (what.cookies) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    if (what.history) stores.history.clear();
    return true;
  });

  ipcMain.handle('pages:choose-download-dir', async (event) => {
    requirePages(event);
    const w = wm.focused();
    const res = await dialog.showOpenDialog(w ? w.win : undefined, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: dl.dir(),
    });
    if (!res.canceled && res.filePaths[0]) {
      stores.settings.set({ downloadDir: res.filePaths[0] });
    }
    return dl.dir();
  });
}

module.exports = { registerIpc };
