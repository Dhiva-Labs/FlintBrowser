'use strict';

// Preload for tab contents (every frame, including iframes).
//
// * Web pages: applies cosmetic ad blocking at document start — scriptlets
//   run in the page's main world before any page script, hiding CSS goes in
//   as a user stylesheet, and generic hiding rules follow the DOM as it grows.
// * flint:// pages: exposes the internal-pages API. The main process also
//   rejects every one of these calls unless the sender frame is a flint://
//   page, so ordinary sites never see the bridge.

const { contextBridge, ipcRenderer, webFrame } = require('electron');

const INVOKE = new Set([
  'pages:boot', 'pages:set-settings',
  'pages:history', 'pages:history-delete', 'pages:history-clear',
  'pages:bookmarks', 'pages:bookmark-delete',
  'pages:downloads', 'pages:download-action', 'pages:downloads-clear',
  'pages:top-sites', 'pages:navigate', 'pages:reader-get',
  'pages:set-default', 'pages:clear-data', 'pages:choose-download-dir',
  'pages:torrents', 'pages:torrent-add', 'pages:torrent-action',
]);

if (location.protocol === 'flint:') {
  contextBridge.exposeInMainWorld('flintPages', {
    invoke: (channel, ...args) => (INVOKE.has(channel)
      ? ipcRenderer.invoke(channel, ...args)
      : Promise.reject(new Error('channel not allowed'))),
  });
} else if (location.protocol === 'http:' || location.protocol === 'https:') {
  applyCosmetics();
}

function insertCss(css) {
  if (css) {
    try { webFrame.insertCSS(css, { cssOrigin: 'user' }); } catch { /* frame gone */ }
  }
}

function applyCosmetics() {
  let payload = null;
  try { payload = ipcRenderer.sendSync('adblock:cosmetics', location.href); } catch { return; }
  if (!payload) return;
  for (const code of payload.scripts) {
    // Runs synchronously in the main world, exempt from the page's CSP.
    webFrame.executeJavaScript(code).catch(() => { });
  }
  insertCss(payload.styles);
  watchGenericHides();
}

// Generic hiding rules are keyed on class/id/href names, so ask for them as
// names first appear: one full scan at DOMContentLoaded, then only the nodes
// that get added, batched.
function watchGenericHides() {
  const seen = { classes: new Set(), ids: new Set(), hrefs: new Set() };
  let roots = [];
  let timer = null;

  const note = (el, out) => {
    const id = el.id;
    if (id && typeof id === 'string' && !seen.ids.has(id)) { seen.ids.add(id); out.ids.push(id); }
    const cl = el.classList;
    if (cl) for (const c of cl) if (!seen.classes.has(c)) { seen.classes.add(c); out.classes.push(c); }
    if (el.localName === 'a') {
      const href = el.getAttribute('href');
      if (href && !seen.hrefs.has(href)) { seen.hrefs.add(href); out.hrefs.push(href); }
    }
  };

  const flush = () => {
    timer = null;
    const batch = roots;
    roots = [];
    const out = { classes: [], ids: [], hrefs: [] };
    for (const root of batch) {
      if (!root.isConnected) continue;
      note(root, out);
      for (const el of root.querySelectorAll('[id],[class],a[href]')) note(el, out);
    }
    if (!out.classes.length && !out.ids.length && !out.hrefs.length) return;
    ipcRenderer.invoke('adblock:dom', location.href, out).then(insertCss, () => { });
  };

  const queue = (node) => {
    if (roots.length > 400) roots = [document.documentElement];
    else roots.push(node);
    if (!timer) timer = setTimeout(flush, 150);
  };

  const start = () => {
    queue(document.documentElement);
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) if (n.nodeType === 1) queue(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
