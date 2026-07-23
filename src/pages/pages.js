'use strict';
/* global flintPages */

const page = document.body.dataset.page;
const call = (ch, ...args) => flintPages.invoke(ch, ...args);
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function letterTile(url) {
  const t = el('div', 'fav-tile');
  try { t.textContent = new URL(url).hostname.replace(/^www\./, '')[0].toUpperCase(); }
  catch { t.textContent = '?'; }
  return t;
}

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const go = (url) => call('pages:navigate', url);

/* ================= home ================= */
if (page === 'home') {
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('q').value.trim();
    if (v) go(v);
  });
  call('pages:top-sites').then((sites) => {
    const dial = $('dial');
    for (const s of sites) {
      const a = el('a');
      a.href = '#';
      const tile = el('div', 'tile');
      try { tile.textContent = new URL(s.url).hostname.replace(/^www\./, '')[0].toUpperCase(); } catch { tile.textContent = '·'; }
      const t = el('div', 't');
      try { t.textContent = new URL(s.url).hostname.replace(/^www\./, ''); } catch { t.textContent = s.title; }
      a.appendChild(tile); a.appendChild(t);
      a.title = s.title;
      a.addEventListener('click', (e) => { e.preventDefault(); go(s.url); });
      dial.appendChild(a);
    }
  });
}

/* ================= settings ================= */
if (page === 'settings') {
  let boot;
  const save = (patch) => call('pages:set-settings', patch);

  function renderAllowlist(list) {
    const box = $('allowlist');
    box.textContent = '';
    $('allowlistRow').style.display = list.length ? '' : 'none';
    list.forEach((host) => {
      const chip = el('span', 'chip', host);
      const x = el('button', null, '✕');
      x.addEventListener('click', async () => {
        const next = list.filter((h) => h !== host);
        await save({ adblockAllowlist: next });
        renderAllowlist(next);
      });
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  call('pages:boot').then((b) => {
    boot = b;
    const s = b.settings;
    for (const e of b.searchEngines) {
      const o = el('option', null, e.name); o.value = e.id; $('searchEngine').appendChild(o);
    }
    for (const p of b.dohProviders) {
      const o = el('option', null, p.name); o.value = p.id; $('dohProvider').appendChild(o);
    }
    const custom = el('option', null, 'Custom…'); custom.value = 'custom'; $('dohProvider').appendChild(custom);

    $('searchEngine').value = s.searchEngine;
    $('theme').value = s.theme;
    $('restoreSession').checked = s.restoreSession;
    $('adblockEnabled').checked = s.adblockEnabled;
    if (!b.adblockReady) $('adblockStatus').textContent = 'Engine missing — reinstall Flint';
    $('dohMode').value = s.doh.mode;
    $('dohProvider').value = s.doh.provider;
    $('dohCustom').value = s.doh.customUrl || '';
    $('dohCustomRow').hidden = s.doh.provider !== 'custom';
    $('httpsOnly').checked = s.httpsOnly;
    $('downloadDir').textContent = b.downloadDir;
    $('turboSegments').value = String(s.turboSegments);
    renderAllowlist(s.adblockAllowlist || []);
  });

  $('searchEngine').addEventListener('change', () => save({ searchEngine: $('searchEngine').value }));
  $('theme').addEventListener('change', () => save({ theme: $('theme').value }));
  $('restoreSession').addEventListener('change', () => save({ restoreSession: $('restoreSession').checked }));
  $('adblockEnabled').addEventListener('change', () => save({ adblockEnabled: $('adblockEnabled').checked }));
  $('httpsOnly').addEventListener('change', () => save({ httpsOnly: $('httpsOnly').checked }));
  $('turboSegments').addEventListener('change', () => save({ turboSegments: Number($('turboSegments').value) }));
  const dohSave = () => save({
    doh: { mode: $('dohMode').value, provider: $('dohProvider').value, customUrl: $('dohCustom').value.trim() },
  });
  $('dohMode').addEventListener('change', dohSave);
  $('dohProvider').addEventListener('change', () => { $('dohCustomRow').hidden = $('dohProvider').value !== 'custom'; dohSave(); });
  $('dohCustom').addEventListener('change', dohSave);
  $('chooseDir').addEventListener('click', async () => { $('downloadDir').textContent = await call('pages:choose-download-dir'); });
  $('setDefault').addEventListener('click', async () => {
    const ok = await call('pages:set-default');
    $('setDefault').textContent = ok ? 'Done ✓' : 'Failed — set in system settings';
  });
  $('clearCache').addEventListener('click', async (e) => { await call('pages:clear-data', { cache: true }); e.target.textContent = 'Cache ✓'; });
  $('clearCookies').addEventListener('click', async (e) => { await call('pages:clear-data', { cookies: true }); e.target.textContent = 'Cookies ✓'; });
  $('clearHistory').addEventListener('click', async (e) => { await call('pages:clear-data', { history: true }); e.target.textContent = 'History ✓'; });
}

/* ================= history ================= */
if (page === 'history') {
  const render = async () => {
    const items = await call('pages:history', $('q').value);
    const list = $('list');
    list.textContent = '';
    $('count').textContent = items.length ? `${items.length} entries` : '';
    if (!items.length) { list.appendChild(el('div', 'empty', 'No history')); return; }
    for (const it of items) {
      const row = el('div', 'row');
      row.appendChild(letterTile(it.url));
      const grow = el('div', 'grow');
      const a = el('a', 'label', it.title || it.url);
      a.href = '#';
      a.addEventListener('click', (e) => { e.preventDefault(); go(it.url); });
      grow.appendChild(a);
      grow.appendChild(el('div', 'sub', it.url));
      row.appendChild(grow);
      row.appendChild(el('div', 'sub', fmtDate(it.ts)));
      const del = el('button', 'small', '✕');
      del.title = 'Remove from history';
      del.addEventListener('click', async () => { await call('pages:history-delete', it.url); render(); });
      row.appendChild(del);
      list.appendChild(row);
    }
  };
  $('q').addEventListener('input', render);
  $('clearAll').addEventListener('click', async () => { await call('pages:history-clear'); render(); });
  render();
}

/* ================= bookmarks ================= */
if (page === 'bookmarks') {
  const render = async () => {
    const items = await call('pages:bookmarks');
    const list = $('list');
    list.textContent = '';
    $('count').textContent = items.length ? `${items.length} saved` : '';
    if (!items.length) { list.appendChild(el('div', 'empty', 'No bookmarks yet — press Ctrl+D on any page')); return; }
    for (const it of [...items].sort((a, b) => b.added - a.added)) {
      const row = el('div', 'row');
      row.appendChild(letterTile(it.url));
      const grow = el('div', 'grow');
      const a = el('a', 'label', it.title || it.url);
      a.href = '#';
      a.addEventListener('click', (e) => { e.preventDefault(); go(it.url); });
      grow.appendChild(a);
      grow.appendChild(el('div', 'sub', it.url));
      row.appendChild(grow);
      const del = el('button', 'small', '✕');
      del.title = 'Delete bookmark';
      del.addEventListener('click', async () => { await call('pages:bookmark-delete', it.id); render(); });
      row.appendChild(del);
      list.appendChild(row);
    }
  };
  render();
}

/* ================= downloads ================= */
if (page === 'downloads') {
  const STATE_LABEL = {
    running: 'Downloading', paused: 'Paused', done: 'Completed',
    cancelled: 'Cancelled', interrupted: 'Failed',
  };
  let timer;
  const render = async () => {
    const items = await call('pages:downloads');
    const list = $('list');
    list.textContent = '';
    $('count').textContent = items.length ? `${items.length}` : '';
    if (!items.length) { list.appendChild(el('div', 'empty', 'No downloads yet')); return; }
    for (const it of items) {
      const row = el('div', 'row');
      const grow = el('div', 'grow');
      const name = el('div', 'label', it.filename + (it.kind === 'turbo' ? '  ⚡' : ''));
      grow.appendChild(name);
      const bits = [STATE_LABEL[it.state] || it.state];
      if (it.state === 'running') {
        bits.push(`${fmtBytes(it.received)}${it.size ? ' / ' + fmtBytes(it.size) : ''}`);
        if (it.speed) bits.push(`${fmtBytes(it.speed)}/s`);
        if (it.kind === 'turbo' && it.segments > 1) bits.push(`${it.segments} connections`);
      } else if (it.state === 'done') {
        bits.push(fmtBytes(it.size || it.received));
      } else if (it.error) {
        bits.push(it.error);
      }
      grow.appendChild(el('div', 'sub', bits.join(' · ')));
      if (it.state === 'running' || it.state === 'paused') {
        const bar = el('div', 'progress');
        const fill = el('div');
        fill.style.width = it.size ? `${Math.min(100, (it.received / it.size) * 100)}%` : '10%';
        bar.appendChild(fill);
        grow.appendChild(bar);
      }
      row.appendChild(grow);
      const actions = el('div', 'actions');
      const btn = (label, act, cls) => {
        const b = el('button', 'small' + (cls ? ' ' + cls : ''), label);
        b.addEventListener('click', async () => { await call('pages:download-action', { id: it.id, action: act }); render(); });
        actions.appendChild(b);
      };
      if (it.state === 'running') { btn('Pause', 'pause'); btn('Cancel', 'cancel', 'danger'); }
      else if (it.state === 'paused') { btn('Resume', 'resume', 'primary'); btn('Cancel', 'cancel', 'danger'); }
      else if (it.state === 'interrupted' && it.kind === 'turbo') { btn('Retry', 'resume', 'primary'); btn('Remove', 'remove'); }
      else if (it.state === 'done') { btn('Open', 'open', 'primary'); btn('Folder', 'show'); btn('Remove', 'remove'); }
      else { btn('Remove', 'remove'); }
      row.appendChild(actions);
      list.appendChild(row);
    }
  };
  $('clearDone').addEventListener('click', async () => { await call('pages:downloads-clear'); render(); });
  render();
  timer = setInterval(render, 700);
  window.addEventListener('beforeunload', () => clearInterval(timer));
}

/* ================= torrents ================= */
if (page === 'torrents') {
  let timer;
  const fmtSpeed = (n) => n ? fmtBytes(n) + '/s' : '';
  const add = async () => {
    const v = $('magnet').value.trim();
    if (!v) return;
    const r = await call('pages:torrent-add', v);
    if (r && r.ok) { $('magnet').value = ''; render(); }
    else if (r && r.error) { $('magnet').value = ''; alertLine(r.error); }
  };
  const alertLine = (msg) => { const e = $('engine-error'); e.hidden = false; e.textContent = msg; };

  const render = async () => {
    const data = await call('pages:torrents');
    if (!data.available) alertLine(data.error || 'Torrent engine unavailable in this edition.');
    const items = data.torrents || [];
    const list = $('list');
    list.textContent = '';
    $('count').textContent = items.length ? `${items.length}` : '';
    if (!items.length) { list.appendChild(el('div', 'empty', 'No torrents. Paste a magnet link above to start.')); return; }
    for (const t of items) {
      const row = el('div', 'row');
      const grow = el('div', 'grow');
      grow.appendChild(el('div', 'label', t.name));
      const pct = Math.round((t.progress || 0) * 100);
      const bits = [
        t.done ? 'Seeding' : (t.paused ? 'Paused' : `${pct}%`),
        fmtBytes(t.downloaded) + (t.size ? ' / ' + fmtBytes(t.size) : ''),
        `${t.peers} peer${t.peers === 1 ? '' : 's'}`,
      ];
      if (!t.done && !t.paused && t.downloadSpeed) bits.push('↓ ' + fmtSpeed(t.downloadSpeed));
      if (t.uploadSpeed) bits.push('↑ ' + fmtSpeed(t.uploadSpeed));
      if (t.error) bits.push(t.error);
      grow.appendChild(el('div', 'sub', bits.filter(Boolean).join(' · ')));
      const bar = el('div', 'progress');
      const fill = el('div');
      fill.style.width = pct + '%';
      if (t.done) fill.style.background = '#3d9e57';
      bar.appendChild(fill);
      grow.appendChild(bar);
      row.appendChild(grow);
      const actions = el('div', 'actions');
      const btn = (label, act, cls) => {
        const b = el('button', 'small' + (cls ? ' ' + cls : ''), label);
        b.addEventListener('click', async () => { await call('pages:torrent-action', { infoHash: t.infoHash, action: act }); render(); });
        actions.appendChild(b);
      };
      if (t.done) btn('Folder', 'open', 'primary');
      else if (t.paused) btn('Resume', 'resume', 'primary');
      else btn('Pause', 'pause');
      btn('Remove', 'remove');
      btn('Delete data', 'remove-data', 'danger');
      row.appendChild(actions);
      list.appendChild(row);
    }
  };
  $('add').addEventListener('click', add);
  $('magnet').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  render();
  timer = setInterval(render, 900);
  window.addEventListener('beforeunload', () => clearInterval(timer));
}

/* ================= about ================= */
if (page === 'about') {
  call('pages:boot').then((b) => {
    document.title = 'About ' + b.productName;
    $('product').textContent = b.productName;
    $('version').textContent = `Version ${b.versions.app} · ${b.edition} edition`;
    if (b.features && b.features.torrents) $('plus-notice').hidden = false;
    const box = $('versions');
    const kv = (k, v) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', null, k));
      row.appendChild(el('span', null, v));
      box.appendChild(row);
    };
    kv('Chromium', b.versions.chrome);
    kv('Electron', b.versions.electron);
    kv('Node.js', b.versions.node);
  });
  document.querySelectorAll('.go').forEach((b) => b.addEventListener('click', () => go(b.dataset.url)));
}

/* ================= reader ================= */
if (page === 'reader') {
  const id = location.hash.slice(1);
  let size = 17;
  call('pages:reader-get', id).then((article) => {
    if (!article) {
      $('title').textContent = 'Article unavailable';
      $('meta').textContent = 'Reader view could not load this article.';
      return;
    }
    document.title = article.title;
    $('title').textContent = article.title;
    const mins = article.length ? Math.max(1, Math.round(article.length / 1100)) : 0;
    $('meta').textContent = [article.siteName, article.byline, mins ? `${mins} min read` : '']
      .filter(Boolean).join(' · ');
    // CSP on this page blocks script execution from injected content.
    $('article').innerHTML = article.content;
    $('open-original').addEventListener('click', () => go(article.url));
  });
  $('font-plus').addEventListener('click', () => {
    size = Math.min(24, size + 1);
    document.documentElement.style.setProperty('--reader-size', size + 'px');
  });
  $('font-minus').addEventListener('click', () => {
    size = Math.max(13, size - 1);
    document.documentElement.style.setProperty('--reader-size', size + 'px');
  });
  $('theme-cycle').addEventListener('click', () => document.body.classList.toggle('sepia'));
}
