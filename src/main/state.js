'use strict';

// Persistent app state: settings, bookmarks, history, downloads, session.
// No Electron imports — the base directory is injected so these are unit-testable.

const fs = require('fs');
const path = require('path');

const SETTINGS_DEFAULTS = {
  searchEngine: 'ddg',
  theme: 'system', // system | light | dark
  adblockEnabled: true,
  adblockAllowlist: [],
  doh: { mode: 'automatic', provider: 'cloudflare', customUrl: '' },
  httpsOnly: false,
  downloadDir: '',
  turboSegments: 6,
  restoreSession: true,
  homePins: [],
  sitePermissions: {},
};

class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = this._load();
    this._timer = null;
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return this.defaults ? deepMerge(structuredClone(this.defaults), raw) : raw;
    } catch {
      return structuredClone(this.defaults || {});
    }
  }

  get() { return this.data; }

  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.data;
  }

  replace(data) {
    this.data = data;
    this.save();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
    if (this._timer.unref) this._timer.unref();
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[state] flush failed for', this.file, err.message);
    }
  }
}

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) base = {};
  for (const [k, v] of Object.entries(patch)) base[k] = deepMerge(base[k], v);
  return base;
}

const HISTORY_CAP = 20000;

class HistoryStore {
  constructor(file) {
    this.store = new JsonStore(file, { entries: {} });
  }

  record(url, title) {
    if (!/^https?:/i.test(url)) return;
    const entries = this.store.get().entries;
    const prev = entries[url];
    entries[url] = {
      t: title || (prev && prev.t) || url,
      ts: Date.now(),
      n: ((prev && prev.n) || 0) + 1,
    };
    this._prune(entries);
    this.store.save();
  }

  updateTitle(url, title) {
    const e = this.store.get().entries[url];
    if (e && title) { e.t = title; this.store.save(); }
  }

  _prune(entries) {
    const keys = Object.keys(entries);
    if (keys.length <= HISTORY_CAP) return;
    keys.sort((a, b) => entries[a].ts - entries[b].ts);
    for (const k of keys.slice(0, keys.length - HISTORY_CAP)) delete entries[k];
  }

  query(text, limit = 50) {
    const q = String(text || '').toLowerCase().trim();
    const entries = this.store.get().entries;
    const out = [];
    for (const [url, e] of Object.entries(entries)) {
      if (q && !url.toLowerCase().includes(q) && !String(e.t).toLowerCase().includes(q)) continue;
      out.push({ url, title: e.t, ts: e.ts, visits: e.n });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out.slice(0, limit);
  }

  suggest(text, limit = 5) {
    const q = String(text || '').toLowerCase().trim();
    if (!q) return [];
    const entries = this.store.get().entries;
    const now = Date.now();
    const out = [];
    for (const [url, e] of Object.entries(entries)) {
      const title = String(e.t).toLowerCase();
      const bare = url.replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
      if (!bare.includes(q) && !title.includes(q)) continue;
      const recency = Math.max(0, 1 - (now - e.ts) / (30 * 864e5));
      const starts = bare.startsWith(q) ? 2 : 0;
      out.push({ url, title: e.t, score: starts + Math.min(e.n, 10) / 10 + recency });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  topSites(limit = 10) {
    const entries = this.store.get().entries;
    const byOrigin = new Map();
    for (const [url, e] of Object.entries(entries)) {
      let origin;
      try { origin = new URL(url).origin; } catch { continue; }
      const cur = byOrigin.get(origin);
      const score = e.n + Math.max(0, 1 - (Date.now() - e.ts) / (30 * 864e5));
      if (!cur || score > cur.score) byOrigin.set(origin, { url, title: e.t, score: (cur ? cur.score : 0) + score });
    }
    return [...byOrigin.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  remove(url) {
    delete this.store.get().entries[url];
    this.store.save();
  }

  clear() { this.store.replace({ entries: {} }); }
  flush() { this.store.flush(); }
}

class BookmarkStore {
  constructor(file) {
    this.store = new JsonStore(file, { items: [] });
  }
  list() { return this.store.get().items; }
  has(url) { return this.list().some((b) => b.url === url); }
  add(url, title) {
    if (this.has(url)) return false;
    this.list().push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, title: title || url, added: Date.now() });
    this.store.save();
    return true;
  }
  remove(url) {
    const items = this.list();
    const idx = items.findIndex((b) => b.url === url || b.id === url);
    if (idx >= 0) { items.splice(idx, 1); this.store.save(); return true; }
    return false;
  }
  toggle(url, title) {
    if (this.has(url)) { this.remove(url); return false; }
    this.add(url, title); return true;
  }
  suggest(text, limit = 3) {
    const q = String(text || '').toLowerCase().trim();
    if (!q) return [];
    return this.list()
      .filter((b) => b.url.toLowerCase().includes(q) || String(b.title).toLowerCase().includes(q))
      .slice(0, limit)
      .map((b) => ({ url: b.url, title: b.title }));
  }
  flush() { this.store.flush(); }
}

function createStores(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  return {
    settings: new JsonStore(path.join(baseDir, 'settings.json'), SETTINGS_DEFAULTS),
    history: new HistoryStore(path.join(baseDir, 'history.json')),
    bookmarks: new BookmarkStore(path.join(baseDir, 'bookmarks.json')),
    downloads: new JsonStore(path.join(baseDir, 'downloads.json'), { items: [] }),
    session: new JsonStore(path.join(baseDir, 'session.json'), { windows: [] }),
    torrents: new JsonStore(path.join(baseDir, 'torrents.json'), { magnets: [] }),
  };
}

module.exports = { JsonStore, HistoryStore, BookmarkStore, createStores, SETTINGS_DEFAULTS };
