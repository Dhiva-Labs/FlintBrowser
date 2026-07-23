'use strict';

// Turbo download: multi-connection segmented HTTP downloader with resume.
// Pure Node module (global fetch) — unit tested against a local server.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MIN_SPLIT_SIZE = 8 * 1024 * 1024; // don't split below 8 MB
const PROGRESS_INTERVAL = 200;

class TurboDownload extends EventEmitter {
  constructor(url, destPath, opts = {}) {
    super();
    this.url = url;
    this.destPath = destPath;
    this.metaPath = destPath + '.flintdl';
    this.headers = opts.headers || {};
    this.maxSegments = Math.max(1, Math.min(16, opts.segments || 6));
    this.state = 'pending'; // running | paused | done | cancelled | error
    this.size = 0;
    this.received = 0;
    this.segments = [];
    this.error = null;
    this._aborts = new Set();
    this._fh = null;
    this._lastEmit = 0;
    this._lastBytes = 0;
    this._lastTime = 0;
    this.speed = 0;
  }

  async _probe() {
    const res = await fetch(this.url, {
      headers: { ...this.headers, Range: 'bytes=0-0' },
      redirect: 'follow',
    });
    const ok = res.status === 206;
    let size = 0;
    if (ok) {
      const cr = res.headers.get('content-range') || '';
      size = parseInt(cr.split('/')[1], 10) || 0;
    } else {
      size = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    }
    try { await res.body?.cancel(); } catch { /* stream may already be closed */ }
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    return { ranges: ok && size > 0, size };
  }

  _plan(size) {
    const perSegment = 2 * 1024 * 1024;
    const n = size >= MIN_SPLIT_SIZE ? Math.min(this.maxSegments, Math.max(2, Math.floor(size / perSegment))) : 1;
    const per = Math.ceil(size / n);
    const segs = [];
    for (let i = 0; i < n; i++) {
      const start = i * per;
      const end = Math.min(size - 1, start + per - 1);
      if (start > end) break;
      segs.push({ start, end, done: 0 });
    }
    return segs;
  }

  _loadMeta() {
    try {
      const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
      if (meta.url === this.url && meta.size > 0 && Array.isArray(meta.segments) && fs.existsSync(this.destPath)) {
        return meta;
      }
    } catch { /* fresh start */ }
    return null;
  }

  _saveMeta() {
    try {
      fs.writeFileSync(this.metaPath, JSON.stringify({ url: this.url, size: this.size, segments: this.segments }));
    } catch { /* best effort */ }
  }

  _emitProgress(force = false) {
    const now = Date.now();
    if (!force && now - this._lastEmit < PROGRESS_INTERVAL) return;
    if (this._lastTime) {
      const dt = (now - this._lastTime) / 1000;
      if (dt > 0.1) {
        this.speed = Math.round((this.received - this._lastBytes) / dt);
        this._lastBytes = this.received;
        this._lastTime = now;
      }
    } else {
      this._lastTime = now;
      this._lastBytes = this.received;
    }
    this._lastEmit = now;
    this.emit('progress', { received: this.received, size: this.size, speed: this.speed });
  }

  async start() {
    try {
      this.state = 'running';
      const resume = this._loadMeta();
      if (resume) {
        this.size = resume.size;
        this.segments = resume.segments;
      } else {
        const probe = await this._probe();
        this.size = probe.size;
        this.segments = probe.ranges ? this._plan(probe.size) : [{ start: 0, end: probe.size ? probe.size - 1 : Infinity, done: 0, whole: true }];
      }
      this.received = this.segments.reduce((a, s) => a + s.done, 0);

      fs.mkdirSync(path.dirname(this.destPath), { recursive: true });
      this._fh = await fs.promises.open(this.destPath, resume ? 'r+' : 'w');

      await Promise.all(this.segments.map((seg) => this._runSegment(seg)));

      if (this.state !== 'running') return this.state; // paused/cancelled midway
      await this._fh.close();
      this._fh = null;
      try { fs.unlinkSync(this.metaPath); } catch { /* no meta */ }
      this.state = 'done';
      this._emitProgress(true);
      this.emit('done');
      return this.state;
    } catch (err) {
      if (this.state === 'paused' || this.state === 'cancelled') return this.state;
      this.state = 'error';
      this.error = err.message || String(err);
      try { await this._fh?.close(); } catch { /* already closed */ }
      this._fh = null;
      this._saveMeta();
      this.emit('error', err);
      return this.state;
    }
  }

  async _runSegment(seg, attempt = 0) {
    if (seg.whole ? seg.done > 0 && seg.done - 1 >= seg.end : seg.start + seg.done > seg.end) return;
    const from = seg.start + seg.done;
    const ac = new AbortController();
    this._aborts.add(ac);
    try {
      const headers = { ...this.headers };
      if (!seg.whole) headers.Range = `bytes=${from}-${seg.end}`;
      const res = await fetch(this.url, { headers, redirect: 'follow', signal: ac.signal });
      if (!seg.whole && res.status !== 206) throw new Error(`expected 206, got ${res.status}`);
      if (seg.whole && !res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      let pos = seg.whole ? seg.done : from;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (this.state !== 'running') { try { await reader.cancel(); } catch { } return; }
        const buf = Buffer.from(value);
        await this._fh.write(buf, 0, buf.length, pos);
        pos += buf.length;
        seg.done += buf.length;
        this.received += buf.length;
        this._emitProgress();
      }
    } catch (err) {
      if (this.state !== 'running') return;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        return this._runSegment(seg, attempt + 1);
      }
      throw err;
    } finally {
      this._aborts.delete(ac);
    }
  }

  async pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    for (const ac of this._aborts) ac.abort();
    try { await this._fh?.close(); } catch { /* already closed */ }
    this._fh = null;
    this._saveMeta();
    this.emit('paused');
  }

  async cancel() {
    this.state = 'cancelled';
    for (const ac of this._aborts) ac.abort();
    try { await this._fh?.close(); } catch { /* already closed */ }
    this._fh = null;
    try { fs.unlinkSync(this.destPath); } catch { /* not created */ }
    try { fs.unlinkSync(this.metaPath); } catch { /* no meta */ }
    this.emit('cancelled');
  }
}

module.exports = { TurboDownload, MIN_SPLIT_SIZE };
