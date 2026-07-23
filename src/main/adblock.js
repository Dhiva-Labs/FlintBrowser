'use strict';

// Network-level ad & tracker blocking using the Ghostery filters engine
// with a prebuilt EasyList + EasyPrivacy engine (see scripts/build-adblock.js).

const fs = require('fs');
const { FiltersEngine, Request } = require('@ghostery/adblocker');

const TYPE_MAP = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
};

class AdBlocker {
  constructor(settingsStore) {
    this.settings = settingsStore;
    this.engine = null;
    this.onBlocked = null; // (webContentsId) => void
  }

  load(enginePath) {
    try {
      this.engine = FiltersEngine.deserialize(fs.readFileSync(enginePath));
      return true;
    } catch (err) {
      console.error('[adblock] failed to load engine:', err.message);
      return false;
    }
  }

  get ready() { return !!this.engine; }

  isSiteAllowlisted(host) {
    if (!host) return false;
    const list = this.settings.get().adblockAllowlist || [];
    return list.some((h) => host === h || host.endsWith('.' + h));
  }

  toggleSite(host) {
    if (!host) return false;
    const s = this.settings.get();
    const list = s.adblockAllowlist || [];
    const idx = list.findIndex((h) => h === host);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(host);
    this.settings.set({ adblockAllowlist: list });
    return idx < 0; // true => now allowlisted (blocking off for site)
  }

  attach(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      try {
        if (!this.engine || !this.settings.get().adblockEnabled) return callback({});
        const type = TYPE_MAP[details.resourceType] || 'other';
        if (type === 'main_frame') return callback({});

        const topUrl = (details.frame && details.frame.top && details.frame.top.url) || details.referrer || '';
        let topHost = '';
        try { topHost = new URL(topUrl).hostname; } catch { /* no top url */ }
        if (topHost && this.isSiteAllowlisted(topHost)) return callback({});

        const { match, redirect } = this.engine.match(Request.fromRawDetails({
          url: details.url,
          type,
          sourceUrl: topUrl,
        }));

        if (match) {
          if (this.onBlocked && details.webContentsId) this.onBlocked(details.webContentsId);
          if (redirect && redirect.dataUrl) return callback({ redirectURL: redirect.dataUrl });
          return callback({ cancel: true });
        }
        return callback({});
      } catch {
        return callback({});
      }
    });
  }

  /** Direct engine check, used by smoke tests. */
  wouldBlock(url, type, sourceUrl) {
    if (!this.engine) return false;
    return this.engine.match(Request.fromRawDetails({ url, type, sourceUrl })).match;
  }
}

module.exports = { AdBlocker };
