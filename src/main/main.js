'use strict';

// Flint Browser — main process entry.

const path = require('path');
const fs = require('fs');
const { app, session, nativeTheme } = require('electron');

const pages = require('./pages');
const doh = require('./doh');
const reader = require('./reader');
const { createStores } = require('./state');
const { AdBlocker } = require('./adblock');
const { DownloadManager } = require('./downloads');
const { WindowManager } = require('./windows');
const { buildMenus } = require('./menus');
const { registerIpc } = require('./ipc');

const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const SMOKE = argv.includes('--smoke');
const profileArg = argv.find((a) => a.startsWith('--profile-dir='));
if (profileArg) {
  app.setPath('userData', path.resolve(profileArg.split('=').slice(1).join('=')));
}

function extractUrls(args) {
  return args.filter((a) => /^(https?|flint):\/\//i.test(a) || (a.endsWith('.html') && fs.existsSync(a)));
}

pages.registerScheme();

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

function boot() {
  const ctx = {};

  app.on('second-instance', (event, argv2) => {
    const w = ctx.wm && ctx.wm.focused();
    if (!w) return;
    const urls = extractUrls(argv2.slice(1));
    for (const u of urls) w.tabs.create(u);
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
  });

  app.on('web-contents-created', (event, wc) => {
    wc.on('will-attach-webview', (e) => e.preventDefault());
  });

  app.whenReady().then(() => {
    const stores = createStores(app.getPath('userData'));
    ctx.stores = stores;

    nativeTheme.themeSource = stores.settings.get().theme === 'light' ? 'light'
      : stores.settings.get().theme === 'dark' ? 'dark' : 'system';

    // Chromium-like UA (sites break on the default Electron token)
    const ua = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
    app.userAgentFallback = ua;

    doh.apply(app, stores.settings.get().doh);

    const blocker = new AdBlocker(stores.settings);
    const enginePath = app.isPackaged
      ? path.join(process.resourcesPath, 'adblock-engine.bin')
      : path.join(__dirname, '..', '..', 'build', 'adblock-engine.bin');
    if (fs.existsSync(enginePath)) blocker.load(enginePath);
    else console.warn('[adblock] engine not found at', enginePath, '- run: npm run build:engine');
    ctx.blocker = blocker;

    const dl = new DownloadManager(stores.downloads, stores.settings);
    ctx.dl = dl;

    ctx.doh = doh;
    ctx.reader = reader;
    ctx.iconPath = path.join(__dirname, '..', '..', 'build', 'icons', '512x512.png');
    ctx.darkTheme = () => nativeTheme.shouldUseDarkColors;

    const blockSyncAt = new Map();
    blocker.onBlocked = (wcId) => {
      if (!ctx.wm) return;
      for (const w of ctx.wm.windows) {
        const tab = w.tabs.byWebContentsId(wcId);
        if (!tab) continue;
        tab.blocked++;
        const now = Date.now();
        if (now - (blockSyncAt.get(wcId) || 0) > 400) {
          blockSyncAt.set(wcId, now);
          w.tabs.sync(tab);
        }
        return;
      }
    };

    ctx.prepareSession = (ses, { incognito = false } = {}) => {
      ses.setUserAgent(ua);
      pages.attach(ses);
      blocker.attach(ses);
      dl.attach(ses);

      ses.setPermissionRequestHandler((wc, permission, callback, details) => {
        const autoAllow = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'mediaKeySystem']);
        if (autoAllow.has(permission)) return callback(true);
        const promptable = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex']);
        if (!promptable.has(permission)) return callback(false);
        if (incognito && permission === 'notifications') return callback(false);

        let origin = '';
        try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch { /* ignore */ }
        const s = ctx.stores.settings.get();
        const saved = origin && s.sitePermissions[origin] && s.sitePermissions[origin][permission];
        if (saved === 'allow') return callback(true);
        if (saved === 'deny') return callback(false);

        const { dialog } = require('electron');
        const w = ctx.wm && ctx.wm.focused();
        const labels = { media: 'use your camera/microphone', geolocation: 'know your location', notifications: 'show notifications', midi: 'use MIDI devices', midiSysex: 'use MIDI devices' };
        dialog.showMessageBox(w ? w.win : undefined, {
          type: 'question',
          buttons: ['Block', 'Allow'],
          defaultId: 0,
          cancelId: 0,
          message: `${origin || 'This site'} wants to ${labels[permission] || permission}`,
        }).then(({ response }) => {
          const allow = response === 1;
          if (origin && !incognito) {
            const perms = ctx.stores.settings.get().sitePermissions;
            perms[origin] = perms[origin] || {};
            perms[origin][permission] = allow ? 'allow' : 'deny';
            ctx.stores.settings.set({ sitePermissions: perms });
          }
          callback(allow);
        }).catch(() => callback(false));
      });
    };

    ctx.prepareSession(session.defaultSession, {});

    const wm = new WindowManager(ctx);
    ctx.wm = wm;

    const menus = buildMenus(ctx);
    ctx.menus = menus;

    dl.onChange = (summary) => wm.broadcast('downloads:badge', summary);

    registerIpc(ctx);

    const initialUrls = extractUrls(argv);
    if (SMOKE) {
      Promise.resolve()
        .then(() => require(path.join(__dirname, '..', '..', 'scripts', 'smoke-run.js'))(ctx))
        .then((code) => { flushAll(ctx); app.exit(code); })
        .catch((err) => { console.error('[smoke] fatal:', err); app.exit(2); });
    } else {
      wm.restore();
      const w = wm.focused();
      if (w && initialUrls.length) for (const u of initialUrls) w.tabs.create(u);
    }
  });

  app.on('window-all-closed', () => {
    flushAll(ctx);
    app.quit();
  });

  app.on('before-quit', () => flushAll(ctx));
}

function flushAll(ctx) {
  try {
    if (!ctx.stores) return;
    ctx.stores.settings.flush();
    ctx.stores.history.flush();
    ctx.stores.bookmarks.flush();
    ctx.stores.session.flush();
    ctx.dl.flush();
  } catch { /* shutting down */ }
}
