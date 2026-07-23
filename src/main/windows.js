'use strict';

// Window management: each FlintWindow is a frameless BaseWindow holding a
// chrome WebContentsView (tab strip + toolbar, drawn by src/ui) stacked above
// per-tab WebContentsViews.

const path = require('path');
const { BaseWindow, WebContentsView, session, nativeTheme } = require('electron');
const { TabManager, TOP_CHROME } = require('./tabs');
const pages = require('./pages');

const CHROME_PRELOAD = path.join(__dirname, '..', 'ui', 'preload-chrome.js');
const CHROME_HTML = path.join(__dirname, '..', 'ui', 'chrome.html');

let nextWindowId = 1;

class FlintWindow {
  constructor(appCtx, { incognito = false } = {}) {
    this.appCtx = appCtx;
    this.incognito = incognito;
    this.id = nextWindowId++;
    this.partition = incognito ? `incog:${this.id}:${Date.now()}` : undefined;
    this.overlayHeight = 0;
    this.htmlFullscreen = false;

    if (incognito) {
      const ses = session.fromPartition(this.partition);
      appCtx.prepareSession(ses, { incognito: true });
    }

    const dark = appCtx.darkTheme();
    this.win = new BaseWindow({
      width: 1280,
      height: 850,
      minWidth: 680,
      minHeight: 440,
      frame: false,
      show: false,
      backgroundColor: incognito ? '#241a30' : (dark ? '#1b1d22' : '#eceff3'),
      icon: appCtx.iconPath,
      title: incognito ? 'Flint Browser (Private)' : 'Flint Browser',
    });

    this.chromeView = new WebContentsView({
      webPreferences: {
        preload: CHROME_PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.chromeView.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.chromeView);
    this.chromeView.webContents.loadFile(CHROME_HTML);
    this.chromeView.webContents.on('did-finish-load', () => {
      this.sendChrome('chrome:init', {
        incognito: this.incognito,
        dark: appCtx.darkTheme(),
        maximized: this.win.isMaximized(),
      });
      this.tabs.sync();
      this.sendChrome('downloads:badge', appCtx.dl.summary());
    });

    this.tabs = new TabManager(this);

    this.win.on('resize', () => this.layout());
    this.win.on('maximize', () => this.sendChrome('chrome:maximized', true));
    this.win.on('unmaximize', () => this.sendChrome('chrome:maximized', false));
    this.win.on('focus', () => { this.appCtx.wm.focusedId = this.id; });
    this.win.on('close', () => {
      if (!this.incognito) this.appCtx.wm.saveSession();
    });
    this.win.on('closed', () => {
      this.tabs.destroy();
      try { this.chromeView.webContents.close(); } catch { /* gone */ }
      this.appCtx.wm.remove(this);
    });

    this.layout();
    this.win.show();
  }

  get chromeHeight() {
    return this.htmlFullscreen ? 0 : TOP_CHROME;
  }

  layout() {
    const { width, height } = this.win.getContentBounds();
    const ch = this.chromeHeight;
    const chromeTotal = ch === 0 ? 0 : ch + this.overlayHeight;
    this.chromeView.setBounds({ x: 0, y: 0, width, height: Math.min(height, chromeTotal) });
    const active = this.tabs.active;
    if (active) {
      active.view.setBounds({ x: 0, y: ch, width, height: height - ch });
    }
  }

  keepChromeOnTop() {
    // Re-adding an existing child view moves it to the top of the z-order.
    this.win.contentView.addChildView(this.chromeView);
  }

  setOverlay(px) {
    this.overlayHeight = Math.max(0, Math.min(600, px | 0));
    this.layout();
  }

  setHtmlFullscreen(on) {
    this.htmlFullscreen = on;
    this.overlayHeight = 0;
    this.layout();
  }

  sendChrome(channel, payload) {
    try {
      if (!this.chromeView.webContents.isDestroyed()) {
        this.chromeView.webContents.send(channel, payload);
      }
    } catch { /* window closing */ }
  }

  focusOmni() {
    this.chromeView.webContents.focus();
    this.sendChrome('chrome:focus-omni');
  }
}

class WindowManager {
  constructor(appCtx) {
    this.appCtx = appCtx;
    this.windows = [];
    this.focusedId = null;
  }

  create({ incognito = false, urls = [], activeIndex = 0 } = {}) {
    const fwin = new FlintWindow(this.appCtx, { incognito });
    this.windows.push(fwin);
    const list = urls.length ? urls : ['flint://home'];
    list.forEach((u, i) => fwin.tabs.create(u, { background: i !== activeIndex }));
    return fwin;
  }

  remove(fwin) {
    const idx = this.windows.indexOf(fwin);
    if (idx >= 0) this.windows.splice(idx, 1);
  }

  focused() {
    return this.windows.find((w) => w.id === this.focusedId) || this.windows[this.windows.length - 1] || null;
  }

  byChromeWebContents(wc) {
    return this.windows.find((w) => w.chromeView.webContents.id === wc.id) || null;
  }

  byTabWebContents(wc) {
    for (const w of this.windows) {
      const tab = w.tabs.byWebContentsId(wc.id);
      if (tab) return { win: w, tab };
    }
    return null;
  }

  broadcast(channel, payload) {
    for (const w of this.windows) w.sendChrome(channel, payload);
  }

  saveSession() {
    const wins = this.windows
      .filter((w) => !w.incognito)
      .map((w) => ({
        tabs: w.tabs.tabs.map((t) => t.wc.getURL()).filter((u) => u && !u.startsWith('devtools:')),
        active: Math.max(0, w.tabs.tabs.findIndex((t) => t.id === w.tabs.activeId)),
      }))
      .filter((w) => w.tabs.length);
    this.appCtx.stores.session.replace({ windows: wins });
  }

  restore() {
    const saved = this.appCtx.stores.session.get().windows || [];
    if (this.appCtx.stores.settings.get().restoreSession && saved.length) {
      for (const w of saved) this.create({ urls: w.tabs, activeIndex: w.active || 0 });
    } else {
      this.create({});
    }
  }
}

module.exports = { FlintWindow, WindowManager, TOP_CHROME, pagesModule: pages };
