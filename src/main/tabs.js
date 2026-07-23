'use strict';

// Tab engine: each tab is a WebContentsView managed per window.

const path = require('path');
const { WebContentsView } = require('electron');

const TOP_CHROME = 88;
const PAGES_PRELOAD = path.join(__dirname, '..', 'pages', 'preload-pages.js');

const HTTP_FALLBACK_ERRORS = new Set([-102, -104, -107, -113, -118, -324]);

function navState(wc) {
  try {
    return { canBack: wc.navigationHistory.canGoBack(), canFwd: wc.navigationHistory.canGoForward() };
  } catch {
    return { canBack: false, canFwd: false };
  }
}

class Tab {
  constructor(fwin, url) {
    this.win = fwin;
    this.view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: PAGES_PRELOAD,
        partition: fwin.partition, // undefined => default session
        safeDialogs: true,
      },
    });
    this.view.setBackgroundColor(fwin.appCtx.darkTheme() ? '#1b1d22' : '#ffffff');
    this.id = this.view.webContents.id;
    this.favicon = '';
    this.blocked = 0;
    this.httpsFallbackHost = null;
    this._wire();
    if (url) this.load(url);
  }

  get wc() { return this.view.webContents; }

  load(url, { httpsFallback = false } = {}) {
    if (httpsFallback) {
      try { this.httpsFallbackHost = new URL(url).hostname; } catch { this.httpsFallbackHost = null; }
    } else {
      this.httpsFallbackHost = null;
    }
    this.wc.loadURL(url).catch(() => { /* did-fail-load handles it */ });
  }

  _wire() {
    const wc = this.wc;
    const sync = () => this.win.tabs.sync(this);

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (url && /^(https?|flint):/i.test(url)) {
        this.win.tabs.create(url, { background: disposition === 'background-tab' });
      }
      return { action: 'deny' };
    });

    wc.on('did-start-loading', sync);
    wc.on('did-stop-loading', sync);

    wc.on('page-title-updated', (e, title) => {
      if (!this.win.incognito) this.win.appCtx.stores.history.updateTitle(wc.getURL(), title);
      sync();
    });

    wc.on('page-favicon-updated', (e, favicons) => {
      this.favicon = favicons && favicons.length ? favicons[favicons.length - 1] : '';
      sync();
    });

    const record = (url) => {
      if (this.win.incognito) return;
      if (!/^https?:/i.test(url)) return;
      this.win.appCtx.stores.history.record(url, wc.getTitle());
    };

    wc.on('did-navigate', (e, url) => {
      this.blocked = 0;
      record(url);
      sync();
    });
    wc.on('did-navigate-in-page', (e, url, isMainFrame) => {
      if (isMainFrame) { record(url); sync(); }
    });

    wc.on('did-fail-load', (e, errorCode, errorDesc, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 /* ABORTED */) return;
      // Typed bare domains try https first; fall back to http when the
      // https attempt cannot connect (unless HTTPS-only mode is on).
      if (this.httpsFallbackHost && validatedURL.startsWith('https://') && HTTP_FALLBACK_ERRORS.has(errorCode)
        && !this.win.appCtx.stores.settings.get().httpsOnly) {
        let host = '';
        try { host = new URL(validatedURL).hostname; } catch { /* ignore */ }
        if (host === this.httpsFallbackHost) {
          const httpUrl = validatedURL.replace(/^https:/, 'http:');
          this.httpsFallbackHost = null;
          this.wc.loadURL(httpUrl).catch(() => { });
          return;
        }
      }
      sync();
    });

    wc.on('context-menu', (e, params) => {
      this.win.appCtx.menus.pageContextMenu(this.win, this, params);
    });

    wc.on('found-in-page', (e, result) => {
      this.win.sendChrome('find:result', {
        matches: result.matches,
        active: result.activeMatchOrdinal,
      });
    });

    wc.on('enter-html-full-screen', () => this.win.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => this.win.setHtmlFullscreen(false));

    wc.on('render-process-gone', (e, details) => {
      if (details.reason !== 'clean-exit') sync();
    });

    wc.on('focus', () => this.win.sendChrome('chrome:blur-omni'));
  }

  snapshot(activeId, bookmarks) {
    const url = this.wc.getURL() || '';
    const { canBack, canFwd } = navState(this.wc);
    return {
      id: this.id,
      title: this.wc.getTitle() || 'New Tab',
      url,
      favicon: this.favicon,
      loading: this.wc.isLoading(),
      active: this.id === activeId,
      blocked: this.blocked,
      canBack,
      canFwd,
      starred: bookmarks.has(url),
      secure: /^(https|flint):/.test(url),
      internal: url.startsWith('flint://'),
    };
  }

  destroy() {
    try { this.wc.close(); } catch { /* already gone */ }
  }
}

class TabManager {
  constructor(fwin) {
    this.win = fwin;
    this.tabs = [];
    this.activeId = null;
    this.closedStack = [];
  }

  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }

  create(url, { background = false } = {}) {
    const tab = new Tab(this.win, url || 'flint://home');
    this.tabs.push(tab);
    this.win.win.contentView.addChildView(tab.view);
    tab.view.setVisible(false);
    this.win.keepChromeOnTop();
    if (!background || this.tabs.length === 1) this.activate(tab.id);
    else this.sync();
    return tab;
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;
    for (const t of this.tabs) t.view.setVisible(t.id === id);
    this.win.layout();
    tab.wc.focus();
    this.sync();
  }

  close(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    const url = tab.wc.getURL();
    if (url && url !== 'flint://home' && !this.win.incognito) {
      this.closedStack.push(url);
      if (this.closedStack.length > 25) this.closedStack.shift();
    }
    this.tabs.splice(idx, 1);
    this.win.win.contentView.removeChildView(tab.view);
    tab.destroy();
    if (this.tabs.length === 0) {
      this.win.win.close();
      return;
    }
    if (this.activeId === id) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activate(next.id);
    } else {
      this.sync();
    }
  }

  reopen() {
    const url = this.closedStack.pop();
    if (url) this.create(url);
  }

  cycle(dir) {
    if (this.tabs.length < 2) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = (idx + dir + this.tabs.length) % this.tabs.length;
    this.activate(this.tabs[next].id);
  }

  activateIndex(i) {
    const tab = i === 8 ? this.tabs[this.tabs.length - 1] : this.tabs[i];
    if (tab) this.activate(tab.id);
  }

  byWebContentsId(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }

  snapshot() {
    const bookmarks = this.win.appCtx.stores.bookmarks;
    return this.tabs.map((t) => t.snapshot(this.activeId, bookmarks));
  }

  sync(tab) {
    this.win.sendChrome('tabs:update', this.snapshot());
    if (!tab || tab.id === this.activeId) {
      const active = this.active;
      if (active) {
        this.win.sendChrome('active:update', active.snapshot(this.activeId, this.win.appCtx.stores.bookmarks));
      }
    }
  }

  destroy() {
    for (const t of this.tabs) t.destroy();
    this.tabs = [];
  }
}

module.exports = { Tab, TabManager, TOP_CHROME };
