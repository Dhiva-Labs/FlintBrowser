'use strict';

// flint:// internal pages served from src/pages via a privileged scheme.

const path = require('path');
const { pathToFileURL } = require('url');
const { protocol, net } = require('electron');
const { STUB_SCHEME } = require('./adblock');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const KNOWN = new Set(['home', 'settings', 'history', 'bookmarks', 'downloads', 'about', 'reader', 'torrents']);

function registerScheme() {
  // Electron accepts a single call, so every privileged scheme is listed here.
  protocol.registerSchemesAsPrivileged([
    { scheme: 'flint', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // Neutered stand-ins (noop.js, ad_status.js, ...) that filter rules
    // redirect blocked requests to; see adblock.js. They replace resources
    // the page already allowed, so the page's CSP must not reject them.
    { scheme: STUB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } },
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
