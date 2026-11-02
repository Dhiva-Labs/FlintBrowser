'use strict';

// Ad & tracker blocking with the Ghostery filters engine and a prebuilt
// EasyList + EasyPrivacy + uBlock Origin engine (see scripts/build-adblock.js).
//
// Three layers:
//   1. Network: every request is matched in onBeforeRequest and cancelled or
//      redirected to a neutered resource.
//   2. Cosmetic: per-site CSS and uBlock scriptlets are handed to each frame's
//      preload at document start (src/pages/preload-pages.js); generic hiding
//      rules follow as the page's DOM reveals class/id names.
//   3. YouTube: its video ads share hosts with the video itself, so only the
//      scriptlets (which strip ad placements from the player data) can stop
//      them. youtube.js adds a fallback that ends any ad that still slips in.

const fs = require('fs');
const { FiltersEngine, Request } = require('@ghostery/adblocker');
const { parse } = require('tldts-experimental');
const youtube = require('./youtube');

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

const COSMETIC_CACHE_MAX = 64;

// Filters such as `||doubleclick.net/instream/ad_status.js$redirect=...` swap
// a blocked request for a harmless stand-in, so pages that check whether the
// resource loaded neither break nor detect the blocker. Chromium refuses to
// redirect web requests to data: URLs (ERR_UNSAFE_REDIRECT), so the stand-ins
// are served from this privileged scheme instead (registered in pages.js).
const STUB_SCHEME = 'flint-res';

/** Parse a `data:` URL into a body and content type. */
function decodeDataUrl(dataUrl) {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const body = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return { body, contentType: m[1] || 'text/plain' };
}

function hostParts(url) {
  const p = parse(url);
  return { hostname: p.hostname || '', domain: p.domain || p.hostname || '' };
}

class AdBlocker {
  constructor(settingsStore) {
    this.settings = settingsStore;
    this.engine = null;
    this.onBlocked = null; // (webContentsId) => void
    this.totalBlocked = 0;
    // hostname -> { styles, scripts } for the document-start payload.
    this._cosmeticCache = new Map();
    // dataUrl -> stub id, and stub id -> { body, contentType }.
    this._stubIds = new Map();
    this._stubs = [];
  }

  /** The flint-res:// URL serving a redirect resource. */
  stubUrl(dataUrl) {
    let id = this._stubIds.get(dataUrl);
    if (id === undefined) {
      const stub = decodeDataUrl(dataUrl);
      if (!stub) return null;
      id = this._stubs.push(stub) - 1;
      this._stubIds.set(dataUrl, id);
    }
    return `${STUB_SCHEME}://stub/${id}`;
  }

  _serveStub(request) {
    let stub = null;
    try { stub = this._stubs[Number(new URL(request.url).pathname.slice(1))]; } catch { /* bad url */ }
    if (!stub) return new Response('', { status: 404 });
    const origin = request.headers.get('origin');
    return new Response(stub.body, {
      headers: {
        'content-type': stub.contentType,
        'access-control-allow-origin': origin && origin !== 'null' ? origin : '*',
        'access-control-allow-credentials': 'true',
        'cache-control': 'no-store',
      },
    });
  }

  load(enginePath) {
    try {
      this.engine = FiltersEngine.deserialize(fs.readFileSync(enginePath));
      this._cosmeticCache.clear();
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

  /** Blocking applies to a frame whose top-level document is `topUrl`. */
  activeFor(topUrl) {
    if (!this.engine || !this.settings.get().adblockEnabled) return false;
    let topHost = '';
    try { topHost = new URL(topUrl).hostname; } catch { /* no top url */ }
    return !(topHost && this.isSiteAllowlisted(topHost));
  }

  attach(ses) {
    if (!ses.protocol.isProtocolHandled(STUB_SCHEME)) {
      ses.protocol.handle(STUB_SCHEME, (request) => this._serveStub(request));
    }
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      try {
        if (!this.engine || details.resourceType === 'mainFrame') return callback({});
        if (!this.settings.get().adblockEnabled) return callback({});

        let topUrl = details.referrer || '';
        try {
          if (details.frame && details.frame.top) topUrl = details.frame.top.url || topUrl;
        } catch { /* frame already gone */ }
        let topHost = '';
        try { topHost = new URL(topUrl).hostname; } catch { /* no top url */ }
        if (topHost && this.isSiteAllowlisted(topHost)) return callback({});

        const { match, redirect } = this.engine.match(Request.fromRawDetails({
          url: details.url,
          type: TYPE_MAP[details.resourceType] || 'other',
          sourceUrl: topUrl,
        }));

        if (match) {
          this.totalBlocked++;
          if (this.onBlocked && details.webContentsId) this.onBlocked(details.webContentsId);
          const stub = redirect && redirect.dataUrl && this.stubUrl(redirect.dataUrl);
          if (stub) return callback({ redirectURL: stub });
          return callback({ cancel: true });
        }
        return callback({});
      } catch {
        return callback({});
      }
    });
  }

  /**
   * Document-start payload for a frame: site-specific hiding CSS, the generic
   * base stylesheet and the scriptlets to run in the page's main world.
   * Returns null when blocking is off for this frame.
   */
  cosmetics(url, topUrl) {
    if (!/^https?:/i.test(url) || !this.activeFor(topUrl || url)) return null;
    const { hostname, domain } = hostParts(url);
    if (!hostname) return null;

    const cached = this._cosmeticCache.get(hostname);
    if (cached) {
      this._cosmeticCache.delete(hostname); // refresh LRU position
      this._cosmeticCache.set(hostname, cached);
      return cached;
    }

    let styles = '';
    let scripts = [];
    try {
      ({ styles, scripts } = this.engine.getCosmeticsFilters({
        url,
        hostname,
        domain,
        getBaseRules: true,
        getInjectionRules: true,
        getExtendedRules: false,
        getRulesFromHostname: true,
        getRulesFromDOM: false,
      }));
    } catch (err) {
      console.error('[adblock] cosmetics failed for', hostname, err.message);
    }
    // Each scriptlet carries its own copy of shared helpers (safeSelf,
    // proxyApplyFn, class JSONPath, ...) as top-level declarations, so each
    // gets a private function scope. Run bare, every copy would overwrite the
    // globals that earlier scriptlets still call through, and their chained
    // Function.prototype.toString proxies end up recursing forever.
    const bundle = [...new Set(scripts)].map((s) => `(function () {\n${s}\n})();`);
    if (youtube.matches(hostname)) {
      styles += '\n' + youtube.STYLES;
      bundle.push(youtube.SCRIPT);
    }

    const result = { styles, scripts: bundle };
    this._cosmeticCache.set(hostname, result);
    if (this._cosmeticCache.size > COSMETIC_CACHE_MAX) {
      this._cosmeticCache.delete(this._cosmeticCache.keys().next().value);
    }
    return result;
  }

  /** Generic hiding rules for class/id/href names seen in a page's DOM. */
  domStyles(url, topUrl, { classes = [], ids = [], hrefs = [] } = {}) {
    if (!/^https?:/i.test(url) || !this.activeFor(topUrl || url)) return '';
    const { hostname, domain } = hostParts(url);
    const strings = (v, max) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, max) : []);
    try {
      return this.engine.getCosmeticsFilters({
        url,
        hostname,
        domain,
        classes: strings(classes, 4000),
        ids: strings(ids, 4000),
        hrefs: strings(hrefs, 1000),
        getBaseRules: false,
        getInjectionRules: false,
        getExtendedRules: false,
        getRulesFromHostname: false,
        getRulesFromDOM: true,
      }).styles;
    } catch {
      return '';
    }
  }

  /** Direct engine check, used by smoke tests. */
  wouldBlock(url, type, sourceUrl) {
    if (!this.engine) return false;
    return this.engine.match(Request.fromRawDetails({ url, type, sourceUrl })).match;
  }
}

module.exports = { AdBlocker, STUB_SCHEME, decodeDataUrl };
