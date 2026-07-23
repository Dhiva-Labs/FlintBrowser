'use strict';

// Download manager: tracks Chromium-native downloads and Flint's own
// multi-connection Turbo downloads in one records list.

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { TurboDownload } = require('./turbo');

const RECORD_CAP = 200;

function sanitizeFilename(name) {
  const clean = String(name || 'download').replace(/[/\\<>:"|?*\x00-\x1f]/g, '_').slice(0, 150);
  return clean || 'download';
}

function dedupePath(dir, name) {
  let file = path.join(dir, name);
  if (!fs.existsSync(file) && !fs.existsSync(file + '.flintdl')) return file;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    file = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(file) && !fs.existsSync(file + '.flintdl')) return file;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

class DownloadManager {
  constructor(recordsStore, settingsStore) {
    this.records = recordsStore;
    this.settings = settingsStore;
    this.live = new Map(); // id -> { item } | { turbo }
    this.onChange = null;
    this._notifyTimer = null;
    let maxId = 0;
    for (const r of this.records.get().items) maxId = Math.max(maxId, Number(r.id) || 0);
    this._nextId = maxId + 1;
    // Anything still marked in-flight from a previous run is stale.
    for (const r of this.records.get().items) {
      if (r.state === 'running' || r.state === 'pending') r.state = r.kind === 'turbo' ? 'paused' : 'interrupted';
    }
  }

  dir() {
    const custom = this.settings.get().downloadDir;
    return custom && fs.existsSync(custom) ? custom : app.getPath('downloads');
  }

  _notify() {
    if (this._notifyTimer) return;
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = null;
      this.records.save();
      if (this.onChange) this.onChange(this.summary());
    }, 250);
    if (this._notifyTimer.unref) this._notifyTimer.unref();
  }

  summary() {
    const items = this.records.get().items;
    const active = items.filter((r) => r.state === 'running' || r.state === 'progressing').length;
    return { active };
  }

  list() {
    return [...this.records.get().items].sort((a, b) => b.ts - a.ts);
  }

  _addRecord(rec) {
    const items = this.records.get().items;
    items.push(rec);
    if (items.length > RECORD_CAP) {
      const removable = items.filter((r) => !['running', 'progressing', 'paused'].includes(r.state));
      for (const r of removable.slice(0, items.length - RECORD_CAP)) {
        items.splice(items.indexOf(r), 1);
      }
    }
    this._notify();
    return rec;
  }

  _get(id) {
    return this.records.get().items.find((r) => String(r.id) === String(id));
  }

  attach(ses) {
    ses.on('will-download', (event, item) => {
      const id = this._nextId++;
      const file = dedupePath(this.dir(), sanitizeFilename(item.getFilename()));
      item.setSavePath(file);
      const rec = this._addRecord({
        id,
        kind: 'native',
        url: item.getURL(),
        filename: path.basename(file),
        path: file,
        size: item.getTotalBytes(),
        received: 0,
        state: 'running',
        speed: 0,
        ts: Date.now(),
      });
      this.live.set(String(id), { item });
      let lastBytes = 0;
      let lastTime = Date.now();
      item.on('updated', (e, state) => {
        rec.received = item.getReceivedBytes();
        rec.size = item.getTotalBytes() || rec.size;
        const now = Date.now();
        if (now - lastTime > 500) {
          rec.speed = Math.round(((rec.received - lastBytes) / (now - lastTime)) * 1000);
          lastBytes = rec.received; lastTime = now;
        }
        rec.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'running');
        this._notify();
      });
      item.on('done', (e, state) => {
        rec.received = item.getReceivedBytes();
        rec.state = state === 'completed' ? 'done' : state; // cancelled | interrupted
        rec.speed = 0;
        this.live.delete(String(id));
        this._notify();
      });
    });
  }

  async startTurbo(url, ses) {
    let cookieHeader = '';
    try {
      const cookies = await ses.cookies.get({ url });
      cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    } catch { /* no cookies */ }

    const nameFromUrl = (() => {
      try { return decodeURIComponent(path.basename(new URL(url).pathname)) || 'download'; }
      catch { return 'download'; }
    })();
    const file = dedupePath(this.dir(), sanitizeFilename(nameFromUrl));

    const id = this._nextId++;
    const rec = this._addRecord({
      id, kind: 'turbo', url, filename: path.basename(file), path: file,
      size: 0, received: 0, state: 'running', speed: 0, ts: Date.now(), segments: 0,
    });
    this._runTurbo(rec, cookieHeader, ses);
    return rec;
  }

  _runTurbo(rec, cookieHeader, ses) {
    const headers = { 'User-Agent': ses ? ses.getUserAgent() : 'FlintBrowser' };
    if (cookieHeader) headers.Cookie = cookieHeader;
    const turbo = new TurboDownload(rec.url, rec.path, {
      headers,
      segments: this.settings.get().turboSegments,
    });
    this.live.set(String(rec.id), { turbo, cookieHeader, ses });
    turbo.on('progress', (p) => {
      rec.received = p.received; rec.size = p.size || rec.size; rec.speed = p.speed;
      rec.segments = turbo.segments.length;
      this._notify();
    });
    turbo.on('done', () => { rec.state = 'done'; rec.speed = 0; this.live.delete(String(rec.id)); this._notify(); });
    turbo.on('paused', () => { rec.state = 'paused'; rec.speed = 0; this._notify(); });
    turbo.on('cancelled', () => { rec.state = 'cancelled'; rec.speed = 0; this.live.delete(String(rec.id)); this._notify(); });
    turbo.on('error', (err) => { rec.state = 'interrupted'; rec.error = err.message; rec.speed = 0; this._notify(); });
    rec.state = 'running';
    this._notify();
    turbo.start();
    return turbo;
  }

  async action(id, act) {
    const rec = this._get(id);
    if (!rec) return false;
    const live = this.live.get(String(id));
    switch (act) {
      case 'pause':
        if (live?.item) live.item.pause();
        else if (live?.turbo) await live.turbo.pause();
        return true;
      case 'resume':
        if (live?.item && live.item.canResume()) live.item.resume();
        else if (live?.turbo) { /* running already */ }
        else if (rec.kind === 'turbo' && (rec.state === 'paused' || rec.state === 'interrupted')) {
          this._runTurbo(rec, live?.cookieHeader || '', live?.ses || null);
        }
        return true;
      case 'cancel':
        if (live?.item) live.item.cancel();
        else if (live?.turbo) await live.turbo.cancel();
        else if (rec.state === 'paused') {
          try { fs.unlinkSync(rec.path); } catch { /* gone */ }
          try { fs.unlinkSync(rec.path + '.flintdl'); } catch { /* gone */ }
          rec.state = 'cancelled';
        }
        this._notify();
        return true;
      case 'open':
        if (rec.state === 'done') shell.openPath(rec.path);
        return true;
      case 'show':
        shell.showItemInFolder(rec.path);
        return true;
      case 'remove': {
        const items = this.records.get().items;
        const idx = items.indexOf(rec);
        if (idx >= 0 && !['running', 'progressing'].includes(rec.state)) { items.splice(idx, 1); this._notify(); }
        return true;
      }
      default:
        return false;
    }
  }

  clearFinished() {
    const items = this.records.get().items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (!['running', 'progressing', 'paused'].includes(items[i].state)) items.splice(i, 1);
    }
    this._notify();
  }

  flush() { this.records.flush(); }
}

module.exports = { DownloadManager, sanitizeFilename, dedupePath };
