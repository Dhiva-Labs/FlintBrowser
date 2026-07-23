'use strict';

// Application menu (accelerators), hamburger menu and page context menus.

const { Menu, clipboard, app } = require('electron');
const { searchUrl } = require('./omni');

function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

function buildMenus(ctx) {
  const withWin = (fn) => () => {
    const w = ctx.wm.focused();
    if (w) fn(w);
  };
  const withTab = (fn) => withWin((w) => {
    const t = w.tabs.active;
    if (t) fn(t, w);
  });

  const actions = {
    newTab: withWin((w) => { w.tabs.create('flint://home'); w.focusOmni(); }),
    newWindow: () => ctx.wm.create({}),
    newIncognito: () => ctx.wm.create({ incognito: true }),
    closeTab: withWin((w) => { if (w.tabs.active) w.tabs.close(w.tabs.activeId); }),
    reopenTab: withWin((w) => w.tabs.reopen()),
    back: withTab((t) => { try { t.wc.navigationHistory.goBack(); } catch { /* nothing */ } }),
    forward: withTab((t) => { try { t.wc.navigationHistory.goForward(); } catch { /* nothing */ } }),
    reload: withTab((t) => t.wc.reload()),
    forceReload: withTab((t) => t.wc.reloadIgnoringCache()),
    stop: withTab((t) => t.wc.stop()),
    home: withTab((t) => t.load('flint://home')),
    focusOmni: withWin((w) => w.focusOmni()),
    find: withWin((w) => w.sendChrome('chrome:find-open')),
    zoom: (delta) => withTab((t, w) => {
      const level = delta === 0 ? 0 : t.wc.getZoomLevel() + delta;
      t.wc.setZoomLevel(level);
      const pct = Math.round(Math.pow(1.2, level) * 100);
      w.sendChrome('toast', { text: `Zoom ${pct}%` });
    })(),
    fullscreen: withWin((w) => w.win.setFullScreen(!w.win.isFullScreen())),
    devtools: withTab((t) => t.wc.toggleDevTools()),
    reader: withTab(async (t, w) => {
      const url = t.wc.getURL();
      if (url.startsWith('flint://')) return;
      const id = await ctx.reader.extract(t.wc);
      if (id) w.tabs.create(`flint://reader#${id}`);
      else w.sendChrome('toast', { text: 'Reader view is not available for this page' });
    }),
    bookmark: withTab((t, w) => {
      const url = t.wc.getURL();
      if (!/^https?:/.test(url)) return;
      const starred = ctx.stores.bookmarks.toggle(url, t.wc.getTitle());
      w.sendChrome('toast', { text: starred ? 'Bookmark added' : 'Bookmark removed' });
      w.tabs.sync();
    }),
    openPage: (page) => withWin((w) => w.tabs.create(`flint://${page}`))(),
    print: withTab((t) => t.wc.print()),
    nextTab: withWin((w) => w.tabs.cycle(1)),
    prevTab: withWin((w) => w.tabs.cycle(-1)),
    tabIndex: (i) => withWin((w) => w.tabs.activateIndex(i))(),
  };

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: actions.newTab },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: actions.newWindow },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: actions.newIncognito },
        { type: 'separator' },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: actions.reopenTab },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: actions.closeTab },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: actions.print },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: actions.find },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: actions.reload },
        { label: 'Reload (F5)', accelerator: 'F5', click: actions.reload, visible: false },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: actions.forceReload },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => actions.zoom(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => actions.zoom(-0.5) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => actions.zoom(0) },
        { type: 'separator' },
        { label: 'Reader View', accelerator: 'CmdOrCtrl+Alt+R', click: actions.reader },
        { type: 'separator' },
        { label: 'Full Screen', accelerator: 'F11', click: actions.fullscreen },
        { label: 'Developer Tools', accelerator: 'F12', click: actions.devtools },
        { label: 'Developer Tools (Ctrl)', accelerator: 'CmdOrCtrl+Shift+I', click: actions.devtools, visible: false },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: actions.back },
        { label: 'Forward', accelerator: 'Alt+Right', click: actions.forward },
        { label: 'Home', accelerator: 'Alt+Home', click: actions.home },
        { type: 'separator' },
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: actions.focusOmni },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Tab', click: actions.nextTab },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+Tab', click: actions.prevTab },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, visible: false,
          click: () => actions.tabIndex(n - 1),
        })),
      ],
    },
    {
      label: 'Library',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: actions.bookmark },
        { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => actions.openPage('bookmarks') },
        { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => actions.openPage('history') },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => actions.openPage('downloads') },
        ...(ctx.edition.features.torrents ? [{ label: 'Torrents', click: () => actions.openPage('torrents') }] : []),
        { type: 'separator' },
        { label: 'Settings', click: () => actions.openPage('settings') },
        { label: `About ${ctx.edition.productName}`, click: () => actions.openPage('about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  function hamburgerMenu(fwin) {
    const menu = Menu.buildFromTemplate([
      { label: 'New Tab', click: actions.newTab },
      { label: 'New Window', click: actions.newWindow },
      { label: 'New Private Window', click: actions.newIncognito },
      { type: 'separator' },
      { label: 'Bookmarks', click: () => actions.openPage('bookmarks') },
      { label: 'History', click: () => actions.openPage('history') },
      { label: 'Downloads', click: () => actions.openPage('downloads') },
      ...(ctx.edition.features.torrents ? [{ label: 'Torrents', click: () => actions.openPage('torrents') }] : []),
      { type: 'separator' },
      { label: 'Zoom In', click: () => actions.zoom(0.5) },
      { label: 'Zoom Out', click: () => actions.zoom(-0.5) },
      { type: 'separator' },
      { label: 'Reader View', click: actions.reader },
      { label: 'Find in Page…', click: actions.find },
      { label: 'Print…', click: actions.print },
      { type: 'separator' },
      { label: 'Settings', click: () => actions.openPage('settings') },
      { label: `About ${ctx.edition.productName}`, click: () => actions.openPage('about') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    popup(menu, fwin);
  }

  function grabberMenu(fwin) {
    const tab = fwin.tabs.active;
    const items = tab && ctx.grabber ? ctx.grabber.list(tab.id) : [];
    const template = items.length ? items.map((m) => ({
      label: `${m.kind === 'audio' ? '♪ ' : '▶ '}${m.name}${m.size ? '  ·  ' + fmtBytes(m.size) : ''}`,
      click: () => ctx.dl.startTurbo(m.url, tab.wc.session),
    })) : [{ label: 'No downloadable media on this page', enabled: false }];
    if (items.length) {
      template.push({ type: 'separator' }, {
        label: 'Download all',
        click: () => items.forEach((m) => ctx.dl.startTurbo(m.url, tab.wc.session)),
      });
    }
    popup(Menu.buildFromTemplate(template), fwin);
  }

  function popup(menu, fwin) {
    try { menu.popup({ window: fwin.win }); }
    catch { menu.popup({}); }
  }

  function pageContextMenu(fwin, tab, params) {
    const items = [];
    const engine = ctx.stores.settings.get().searchEngine;

    if (params.linkURL && /^magnet:/i.test(params.linkURL) && ctx.torrents) {
      items.push(
        { label: 'Open Magnet in Flint', click: () => ctx.handleMagnet(params.linkURL, fwin) },
        { label: 'Copy Magnet Link', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      );
    } else if (params.linkURL) {
      items.push(
        { label: 'Open Link in New Tab', click: () => fwin.tabs.create(params.linkURL, { background: true }) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        { label: 'Turbo Download Link', click: () => ctx.dl.startTurbo(params.linkURL, tab.wc.session) },
        { type: 'separator' },
      );
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: 'Open Image in New Tab', click: () => fwin.tabs.create(params.srcURL, { background: true }) },
        { label: 'Save Image', click: () => tab.wc.downloadURL(params.srcURL) },
        { label: 'Copy Image', click: () => tab.wc.copyImageAt(params.x, params.y) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
        { type: 'separator' },
      );
    }
    if (params.selectionText && params.selectionText.trim()) {
      const sel = params.selectionText.trim();
      const short = sel.length > 30 ? sel.slice(0, 30) + '…' : sel;
      items.push(
        { role: 'copy' },
        { label: `Search for “${short}”`, click: () => fwin.tabs.create(searchUrl(engine, sel), { background: true }) },
        { type: 'separator' },
      );
    }
    if (params.isEditable) {
      items.push({ role: 'undo' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
    }
    if (!params.linkURL && !params.selectionText && params.mediaType === 'none' && !params.isEditable) {
      items.push(
        { label: 'Back', enabled: tab.snapshot(fwin.tabs.activeId, ctx.stores.bookmarks).canBack, click: actions.back },
        { label: 'Forward', enabled: tab.snapshot(fwin.tabs.activeId, ctx.stores.bookmarks).canFwd, click: actions.forward },
        { label: 'Reload', click: actions.reload },
        { type: 'separator' },
        { label: 'Bookmark This Page', click: actions.bookmark },
        { label: 'Reader View', click: actions.reader },
        { label: 'Print…', click: actions.print },
        { type: 'separator' },
      );
    }
    items.push({ label: 'Inspect Element', click: () => tab.wc.inspectElement(params.x, params.y) });
    popup(Menu.buildFromTemplate(items), fwin);
  }

  return { actions, hamburgerMenu, pageContextMenu, grabberMenu };
}

module.exports = { buildMenus };
