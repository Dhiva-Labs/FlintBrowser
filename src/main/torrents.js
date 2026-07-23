'use strict';

// BitTorrent client (Flint Plus only), built on WebTorrent.
//
// BitTorrent is a lawful, general-purpose file-distribution protocol. Flint
// ships no trackers, no content indexes and no piracy shortcuts; it is a neutral
// client for content the user chooses to fetch or seed. WebTorrent is required
// lazily so the standard edition never loads it.

const fs = require('fs');
const path = require('path');

const MAGNET_RE = /^magnet:\?.*xt=urn:bt/i;

function isMagnet(s) { return typeof s === 'string' && MAGNET_RE.test(s.trim()); }

class TorrentEngine {
  constructor(store, dirFn) {
    this.store = store;      // JsonStore { magnets: [] }
    this.dirFn = dirFn;      // () => download directory
    this.client = null;
    this.available = true;
    this.error = null;
    this.onChange = null;    // () => void
    this._notifyTimer = null;
  }

  _ensure() {
    if (this.client) return this.client;
    try {
      const WebTorrent = require('webtorrent');
      this.client = new WebTorrent();
      this.client.on('error', (err) => { this.error = err.message || String(err); this._notify(); });
      return this.client;
    } catch (err) {
      this.available = false;
      this.error = 'Torrent engine unavailable: ' + (err.message || err);
      console.error('[torrents]', this.error);
      return null;
    }
  }

  dir() { return this.dirFn(); }

  _notify() {
    if (this._notifyTimer) return;
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = null;
      if (this.onChange) this.onChange();
    }, 300);
    if (this._notifyTimer.unref) this._notifyTimer.unref();
  }

  _persist() {
    if (!this.client) return;
    const magnets = this.client.torrents.map((t) => t.magnetURI).filter(Boolean);
    this.store.replace({ magnets });
  }

  _wire(torrent) {
    const bump = () => this._notify();
    torrent.on('done', bump);
    torrent.on('ready', () => { this._persist(); bump(); });
    torrent.on('metadata', () => { this._persist(); bump(); });
    torrent.on('error', (err) => { torrent._flintError = err.message || String(err); bump(); });
    torrent.on('noPeers', bump);
    let last = 0;
    torrent.on('download', () => {
      const now = Date.now();
      if (now - last > 500) { last = now; this._notify(); }
    });
  }

  /** Add a magnet URI, .torrent path, URL or Buffer. Returns {ok, infoHash?, error?}. */
  add(source, opts = {}) {
    const client = this._ensure();
    if (!client) return { ok: false, error: this.error };
    try {
      const src = typeof source === 'string' ? source.trim() : source;
      // De-dupe: if already present, no-op.
      if (isMagnet(src)) {
        const m = /xt=urn:btih:([a-z0-9]+)/i.exec(src);
        const ih = m ? m[1].toLowerCase() : null;
        if (ih && client.get(ih)) return { ok: true, infoHash: ih, existing: true };
      }
      const torrent = client.add(src, { path: opts.path || this.dir(), announce: opts.announce }, () => {
        this._persist();
      });
      this._wire(torrent);
      return { ok: true, infoHash: torrent.infoHash || null };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  /** Seed a file/buffer (used for sharing and by the loopback self-test). */
  seed(input, opts, cb) {
    const client = this._ensure();
    if (!client) { cb && cb(new Error(this.error)); return; }
    const torrent = client.seed(input, opts || {}, (t) => cb && cb(null, t));
    this._wire(torrent);
    return torrent;
  }

  list() {
    if (!this.client) return [];
    return this.client.torrents.map((t) => ({
      infoHash: t.infoHash,
      name: t.name || 'Fetching metadata…',
      magnetURI: t.magnetURI,
      progress: t.progress || 0,
      size: t.length || 0,
      downloaded: t.downloaded || 0,
      uploaded: t.uploaded || 0,
      downloadSpeed: t.downloadSpeed || 0,
      uploadSpeed: t.uploadSpeed || 0,
      peers: t.numPeers || 0,
      done: t.done || false,
      paused: t.paused || false,
      ratio: t.ratio || 0,
      timeRemaining: isFinite(t.timeRemaining) ? t.timeRemaining : 0,
      error: t._flintError || null,
      files: (t.files || []).map((f) => ({ name: f.name, size: f.length, progress: f.progress || 0 })),
    }));
  }

  action(infoHash, act) {
    if (!this.client) return false;
    const t = this.client.get(infoHash);
    if (!t) return false;
    switch (act) {
      case 'pause': t.pause(); this._notify(); return true;
      case 'resume': t.resume(); this._notify(); return true;
      case 'remove':
        this.client.remove(infoHash, { destroyStore: false }, () => { this._persist(); this._notify(); });
        return true;
      case 'remove-data':
        this.client.remove(infoHash, { destroyStore: true }, () => { this._persist(); this._notify(); });
        return true;
      case 'open':
        if (t.done && t.files && t.files[0]) {
          const p = path.join(t.path, t.files[0].path);
          require('electron').shell.showItemInFolder(p);
        }
        return true;
      default: return false;
    }
  }

  summary() {
    if (!this.client) return { active: 0 };
    return { active: this.client.torrents.filter((t) => !t.done && !t.paused).length };
  }

  restore() {
    const magnets = (this.store.get().magnets || []).filter(isMagnet);
    for (const m of magnets) {
      try { this.add(m); } catch { /* skip bad entry */ }
    }
  }

  destroy(cb) {
    if (this.client) this.client.destroy(cb);
    else if (cb) cb();
  }
}

module.exports = { TorrentEngine, isMagnet };
