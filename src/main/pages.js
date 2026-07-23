'use strict';

// flint:// internal pages served from src/pages via a privileged scheme.

const path = require('path');
const { pathToFileURL } = require('url');
const { protocol, net } = require('electron');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const KNOWN = new Set(['home', 'settings', 'history', 'bookmarks', 'downloads', 'about', 'reader', 'torrents']);

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'flint', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

function handler(request) {
  const u = new URL(request.url);
  let file;
  if (u.pathname && u.pathname !== '/') {
    // Shared assets referenced as absolute paths, e.g. flint://home/pages.css
    file = path.join(PAGES_DIR, path.basename(u.pathname));
  } else {
    const host = KNOWN.has(u.hostname) ? u.hostname : 'home';
    file = path.join(PAGES_DIR, host + '.html');
  }
  return net.fetch(pathToFileURL(file).toString());
}

function attach(ses) {
  if (!ses.protocol.isProtocolHandled('flint')) {
    ses.protocol.handle('flint', handler);
  }
}

module.exports = { registerScheme, attach, KNOWN };
