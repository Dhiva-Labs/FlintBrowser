'use strict';
/* global flint */

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const omni = $('omni');
const omnibox = $('omnibox');
const omniIcon = $('omni-icon');
const omniDisplay = $('omni-display');
const sugEl = $('suggestions');
const findbar = $('findbar');
const findInput = $('find-input');
const shieldPanel = $('shield-panel');
const toastEl = $('toast');

let activeInfo = null;
let suggestions = [];
let sugSel = 0;
let sugQuery = '';
let omniEditing = false;
let toastTimer = null;

const ICONS = {
  lock: '<svg viewBox="0 0 20 20"><rect x="4.5" y="9" width="11" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  globe: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 10h14M10 3c-4.5 4.7-4.5 9.3 0 14 4.5-4.7 4.5-9.3 0-14z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  flame: '<svg viewBox="0 0 20 20"><path d="M10 2.5c1.6 2.6 4.5 4.4 4.5 7.8A4.6 4.6 0 0 1 10 15a4.6 4.6 0 0 1-4.5-4.7c0-1.9.9-3.2 1.9-4.4-.1 1.4.4 2.2 1.2 2.6-.4-1.7 0-4 1.4-6z" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 20 20"><path d="M10 3.5l7.5 13h-15z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8.5v3.5m0 2v.5" stroke="currentColor" stroke-width="1.5"/></svg>',
  search: '<svg viewBox="0 0 20 20"><circle cx="8.8" cy="8.8" r="5.3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12.8 12.8l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  history: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 6.3V10l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  bookmark: '<svg viewBox="0 0 20 20"><path d="M10 2.8l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8l5-.7z" fill="currentColor"/></svg>',
  url: '<svg viewBox="0 0 20 20"><path d="M4 10h11M11 5.5L15.5 10 11 14.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  speaker: '<svg viewBox="0 0 20 20"><path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z" fill="currentColor"/><path d="M13.5 7a4 4 0 0 1 0 6M15.5 5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 20 20"><path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z" fill="currentColor"/><path d="M13.5 8l4 4M17.5 8l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

/* ---------- overlay height coordination ---------- */
function syncOverlay() {
  let h = 0;
  if (!sugEl.hidden) h = Math.max(h, sugEl.offsetHeight + 12);
  if (!findbar.hidden) h = Math.max(h, findbar.offsetHeight + 12);
  if (!shieldPanel.hidden) h = Math.max(h, shieldPanel.offsetHeight + 14);
  if (!toastEl.hidden) h = Math.max(h, toastEl.offsetHeight + 16);
  flint.send('chrome:overlay', h);
}

/* ---------- tabs (keyed: elements are reused across updates) ---------- */
const tabEls = new Map(); // id -> { el, fav, title, audio, pill, close, last }
let tabOrder = [];

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function makeFav(t) {
  if (t.loading) {
    const d = document.createElement('div');
    d.className = 'fav spin';
    return d;
  }
  if (t.internal) {
    const d = document.createElement('div');
    d.className = 'fav internal';
    d.innerHTML = ICONS.flame;
    return d;
  }
  if (t.favicon) {
    const img = document.createElement('img');
    img.className = 'fav';
    img.src = t.favicon;
    img.onerror = () => img.replaceWith(makeLetter(t));
    return img;
  }
  return makeLetter(t);
}

function makeLetter(t) {
  const d = document.createElement('div');
  d.className = 'fav letter';
  d.textContent = (hostOf(t.url)[0] || '·').toUpperCase();
  return d;
}

function createTabEl(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.dataset.id = id;
  const title = document.createElement('span');
  title.className = 'title';
  const audio = document.createElement('button');
  audio.className = 'audio';
  audio.hidden = true;
  audio.addEventListener('mousedown', (e) => e.stopPropagation());
  audio.addEventListener('click', (e) => { e.stopPropagation(); flint.send('tabs:mute', id); });
  const pill = document.createElement('span');
  pill.className = 'blocked-pill';
  pill.hidden = true;
  const close = document.createElement('button');
  close.className = 'close';
  close.title = 'Close tab (Ctrl+W)';
  close.innerHTML = ICONS.close;
  close.addEventListener('mousedown', (e) => e.stopPropagation());
  close.addEventListener('click', (e) => { e.stopPropagation(); flint.send('tabs:close', id); });
  const fav = document.createElement('div');
  fav.className = 'fav';
  el.append(fav, title, audio, pill, close);

  el.addEventListener('mousedown', (e) => { if (e.button === 0) flint.send('tabs:activate', id); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) flint.send('tabs:close', id); });
  wireDrag(el, id);
  const entry = { el, fav, title, audio, pill, close, last: {} };
  tabEls.set(id, entry);
  return entry;
}

function updateTabEl(entry, t) {
  const { el, last } = entry;
  el.classList.toggle('active', t.active);
  el.classList.toggle('pending', !!t.pending);
  if (last.title !== t.title || last.url !== t.url) {
    entry.title.textContent = t.title;
    el.title = t.url && !t.internal ? `${t.title}\n${hostOf(t.url)}` : t.title;
  }
  const favKey = `${t.loading}|${t.internal}|${t.favicon}|${hostOf(t.url)}`;
  if (last.favKey !== favKey) {
    const fresh = makeFav(t);
    entry.fav.replaceWith(fresh);
    entry.fav = fresh;
  }
  if (last.audible !== t.audible || last.muted !== t.muted) {
    entry.audio.hidden = !(t.audible || t.muted);
    entry.audio.classList.toggle('muted', !!t.muted);
    entry.audio.innerHTML = t.muted ? ICONS.muted : ICONS.speaker;
    entry.audio.title = t.muted ? 'Unmute tab' : 'Mute tab';
  }
  if (last.blocked !== t.blocked) {
    entry.pill.hidden = !(t.blocked > 0);
    entry.pill.textContent = t.blocked > 99 ? '99+' : String(t.blocked);
    entry.pill.title = `${t.blocked} ads & trackers blocked`;
  }
  entry.last = { ...t, favKey };
}

function renderTabs(tabs) {
  const seen = new Set();
  let prev = null;
  for (const t of tabs) {
    seen.add(t.id);
    const entry = tabEls.get(t.id) || createTabEl(t.id);
    updateTabEl(entry, t);
    // Move into place only when out of order (keeps hover/drag state intact).
    const want = prev ? prev.nextSibling : tabsEl.firstChild;
    if (want !== entry.el) tabsEl.insertBefore(entry.el, want);
    prev = entry.el;
  }
  for (const [id, entry] of tabEls) {
    if (!seen.has(id)) { entry.el.remove(); tabEls.delete(id); }
  }
  tabOrder = tabs.map((t) => t.id);
  fitTabs();
  const activeEl = tabsEl.querySelector('.tab.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function fitTabs() {
  // Compact (icon-only) once the title would get less than ~40px.
  for (const { el, audio, pill } of tabEls.values()) {
    const extras = (audio.hidden ? 0 : 27) + (pill.hidden ? 0 : 30);
    el.classList.toggle('narrow', el.offsetWidth < 104 + extras);
  }
}
window.addEventListener('resize', fitTabs);

/* drag to reorder */
let dragId = null;
function clearDropMarks() {
  for (const { el } of tabEls.values()) el.classList.remove('drop-before', 'drop-after', 'dragging');
}
function wireDrag(el, id) {
  el.addEventListener('dragstart', (e) => {
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => { dragId = null; clearDropMarks(); });
  el.addEventListener('dragover', (e) => {
    if (dragId === null || dragId === id) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    el.classList.toggle('drop-after', after);
    el.classList.toggle('drop-before', !after);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragId === null || dragId === id) return;
    const after = el.classList.contains('drop-after');
    const from = tabOrder.indexOf(dragId);
    let to = tabOrder.indexOf(id) + (after ? 1 : 0);
    if (from < to) to -= 1; // index after the dragged tab is taken out
    flint.send('tabs:move', { id: dragId, index: to });
    clearDropMarks();
  });
}

/* ---------- active tab / omnibox ---------- */
function displayUrl(url) {
  if (!url || url === 'flint://home' || url === 'flint://home/') return '';
  return url;
}

function renderOmniDisplay() {
  const url = activeInfo ? displayUrl(activeInfo.url) : '';
  const show = !!url && !omniEditing && document.activeElement !== omni;
  omnibox.classList.toggle('show-display', show);
  omniDisplay.hidden = !show;
  if (!show) return;
  omniDisplay.textContent = '';
  let host = '';
  let rest = '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      host = u.host;
      rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
    } else if (u.protocol === 'http:') {
      host = u.host;
      rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
      const scheme = document.createElement('span');
      scheme.className = 'rest';
      scheme.textContent = 'http://';
      omniDisplay.appendChild(scheme);
    } else {
      host = url;
    }
  } catch { host = url; }
  const h = document.createElement('span');
  h.className = 'host';
  h.textContent = host;
  const r = document.createElement('span');
  r.className = 'rest';
  r.textContent = rest;
  omniDisplay.append(h, r);
}

function renderActive(info) {
  activeInfo = info;
  $('btn-back').disabled = !info.canBack;
  $('btn-fwd').disabled = !info.canFwd;
  $('ic-reload').hidden = info.loading;
  $('ic-stop').hidden = !info.loading;
  $('btn-reload').title = info.loading ? 'Stop (Esc)' : 'Reload (Ctrl+R)';
  $('progress').hidden = !info.loading;
  $('btn-star').classList.toggle('starred', !!info.starred);
  $('btn-star').title = info.starred ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';
  $('btn-star').hidden = !/^https?:/.test(info.url);

  const zoom = $('btn-zoom');
  zoom.hidden = !info.zoom || info.zoom === 100;
  zoom.textContent = `${info.zoom}%`;

  if (!omniEditing) omni.value = displayUrl(info.url);
  renderOmniDisplay();

  if (info.internal) { omniIcon.innerHTML = ICONS.flame; omniIcon.className = 'internal'; omniIcon.title = 'Flint page'; }
  else if (info.url.startsWith('https:')) { omniIcon.innerHTML = ICONS.lock; omniIcon.className = 'secure'; omniIcon.title = 'Connection is secure'; }
  else if (info.url.startsWith('http:')) { omniIcon.innerHTML = ICONS.warn; omniIcon.className = 'insecure'; omniIcon.title = 'Not secure'; }
  else { omniIcon.innerHTML = ICONS.globe; omniIcon.className = ''; omniIcon.title = ''; }

  const shield = $('btn-shield');
  shield.classList.toggle('on', info.shield === true);
  shield.classList.toggle('off', info.shield === false);
  const count = $('shield-count');
  count.hidden = !(info.blocked > 0) || info.shield === false;
  count.textContent = info.blocked > 99 ? '99+' : String(info.blocked);
  if (!shieldPanel.hidden) $('sp-count').textContent = String(info.blocked || 0);
}

/* ---------- suggestions ---------- */
function highlight(target, text, query) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) { target.textContent = text; return; }
  const b = document.createElement('b');
  b.textContent = text.slice(i, i + q.length);
  target.append(text.slice(0, i), b, text.slice(i + q.length));
}

function renderSuggestions() {
  sugEl.textContent = '';
  if (!suggestions.length) { sugEl.hidden = true; syncOverlay(); return; }
  suggestions.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sug' + (i === sugSel ? ' sel' : '');
    const ic = document.createElement('span'); ic.className = 'si'; ic.innerHTML = ICONS[s.type] || ICONS.globe;
    const tx = document.createElement('span'); tx.className = 'st';
    if (s.type === 'history' || s.type === 'bookmark') highlight(tx, s.text, sugQuery);
    else tx.textContent = s.text;
    row.append(ic, tx);
    if (s.detail) {
      const d = document.createElement('span');
      d.className = 'sd';
      highlight(d, s.detail.replace(/^https?:\/\/(www\.)?/, ''), sugQuery);
      row.appendChild(d);
    }
    row.addEventListener('mousedown', (e) => { e.preventDefault(); acceptSuggestion(i); });
    row.addEventListener('mousemove', () => {
      if (sugSel === i) return;
      sugEl.children[sugSel]?.classList.remove('sel');
      sugSel = i;
      row.classList.add('sel');
    });
    sugEl.appendChild(row);
  });
  // Anchor the dropdown to the address field so it tracks any window width.
  const r = omnibox.getBoundingClientRect();
  sugEl.style.left = `${Math.round(r.left)}px`;
  sugEl.style.width = `${Math.round(r.width)}px`;
  sugEl.style.right = 'auto';
  sugEl.hidden = false;
  syncOverlay();
}

function closeSuggestions() {
  suggestions = []; sugSel = 0;
  if (sugEl.hidden) return;
  sugEl.hidden = true;
  syncOverlay();
}

function acceptSuggestion(i) {
  const s = suggestions[i];
  closeSuggestions();
  omniEditing = false;
  omni.blur();
  if (!s) return;
  if (s.url) flint.send('omni:navigate', s.url);
  else flint.send('omni:resolve', s.query || omni.value);
}

let sugTimer = null;
omni.addEventListener('input', () => {
  omniEditing = true;
  renderOmniDisplay();
  clearTimeout(sugTimer);
  const text = omni.value;
  if (!text.trim()) { closeSuggestions(); return; }
  sugTimer = setTimeout(async () => {
    try {
      const rows = await flint.invoke('omni:suggest', text);
      if (omni.value !== text) return; // stale
      suggestions = rows;
      sugQuery = text;
      sugSel = 0;
      renderSuggestions();
    } catch { /* ignore */ }
  }, 60);
});

omni.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!sugEl.hidden && suggestions.length) acceptSuggestion(sugSel);
    else {
      const v = omni.value;
      omniEditing = false;
      omni.blur();
      closeSuggestions();
      flint.send('omni:resolve', v);
    }
  } else if (e.key === 'ArrowDown' && suggestions.length) {
    e.preventDefault(); sugSel = (sugSel + 1) % suggestions.length; renderSuggestions();
  } else if (e.key === 'ArrowUp' && suggestions.length) {
    e.preventDefault(); sugSel = (sugSel - 1 + suggestions.length) % suggestions.length; renderSuggestions();
  } else if (e.key === 'Escape') {
    if (!sugEl.hidden) { closeSuggestions(); return; }
    omniEditing = false;
    omni.value = activeInfo ? displayUrl(activeInfo.url) : '';
    omni.blur();
    flint.send('find:stop', true); // refocuses the page
  }
});

omni.addEventListener('focus', () => {
  omnibox.classList.add('focused');
  renderOmniDisplay();
  closeShieldPanel();
  requestAnimationFrame(() => omni.select());
});
omni.addEventListener('blur', () => {
  omnibox.classList.remove('focused');
  setTimeout(() => {
    if (document.activeElement !== omni) {
      omniEditing = false;
      closeSuggestions();
      if (activeInfo) omni.value = displayUrl(activeInfo.url);
      renderOmniDisplay();
    }
  }, 80);
});

/* ---------- find bar ---------- */
let findOpen = false;
function openFind() {
  findOpen = true;
  closeShieldPanel();
  findbar.hidden = false;
  $('find-count').textContent = '';
  syncOverlay();
  findInput.focus();
  findInput.select();
}
function closeFind() {
  findOpen = false;
  findbar.hidden = true;
  syncOverlay();
  flint.send('find:stop', false);
}
findInput.addEventListener('input', () => {
  if (findInput.value) flint.send('find:start', { text: findInput.value, forward: true, first: true });
  else $('find-count').textContent = '';
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') flint.send('find:start', { text: findInput.value, forward: !e.shiftKey, first: false });
  if (e.key === 'Escape') closeFind();
});
$('find-prev').addEventListener('click', () => flint.send('find:start', { text: findInput.value, forward: false, first: false }));
$('find-next').addEventListener('click', () => flint.send('find:start', { text: findInput.value, forward: true, first: false }));
$('find-close').addEventListener('click', closeFind);

/* ---------- shield panel ---------- */
async function openShieldPanel() {
  const info = await flint.invoke('shield:info');
  closeSuggestions();
  $('sp-host').textContent = info.host || 'Flint page';
  $('sp-count').textContent = String(info.count || 0);
  const toggle = $('sp-toggle');
  const row = $('sp-toggle-row');
  toggle.checked = info.enabled && !info.siteAllowed;
  toggle.disabled = !info.enabled || !info.host;
  row.hidden = !info.host;
  $('sp-note').textContent = !info.host ? 'Flint’s own pages never load ads or trackers.'
    : !info.enabled ? 'Blocking is turned off for all sites in Settings.' : '';
  $('sp-total').textContent = `${Number(info.total || 0).toLocaleString()} blocked in total`;
  const clear = $('sp-clear');
  clear.hidden = !info.host;
  clear.disabled = false;
  clear.classList.remove('confirm');
  clear.textContent = 'Clear cookies & site data';
  const r = $('btn-shield').getBoundingClientRect();
  shieldPanel.style.left = `${Math.max(8, Math.round(r.right - 300))}px`;
  shieldPanel.hidden = false;
  $('btn-shield').classList.add('open');
  syncOverlay();
}
function closeShieldPanel() {
  if (shieldPanel.hidden) return;
  shieldPanel.hidden = true;
  $('btn-shield').classList.remove('open');
  syncOverlay();
}
$('sp-toggle').addEventListener('change', async () => {
  const allowed = await flint.invoke('shield:toggle-site');
  if (allowed === null) return;
  $('sp-toggle').checked = !allowed;
  $('sp-note').textContent = allowed ? 'Blocking paused on this site. Reloading…' : 'Blocking on. Reloading…';
  $('sp-count').textContent = '0';
  syncOverlay();
});
// Two-step: the first click arms the button, the second clears.
$('sp-clear').addEventListener('click', async () => {
  const btn = $('sp-clear');
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.textContent = 'Click again to clear — signs you out of this site';
    syncOverlay();
    return;
  }
  btn.disabled = true;
  const site = await flint.invoke('shield:clear-site');
  btn.classList.remove('confirm');
  btn.textContent = site ? `Cleared ${site}. Reloading…` : 'Nothing to clear here';
});
$('sp-settings').addEventListener('click', () => { closeShieldPanel(); flint.send('settings:open'); });
document.addEventListener('mousedown', (e) => {
  if (!shieldPanel.hidden && !shieldPanel.contains(e.target) && !$('btn-shield').contains(e.target)) closeShieldPanel();
});

/* ---------- toolbar buttons ---------- */
$('btn-back').addEventListener('click', () => flint.send('nav:go', 'back'));
$('btn-fwd').addEventListener('click', () => flint.send('nav:go', 'forward'));
$('btn-reload').addEventListener('click', () => flint.send('nav:go', activeInfo && activeInfo.loading ? 'stop' : 'reload'));
$('btn-home').addEventListener('click', () => flint.send('nav:go', 'home'));
$('btn-newtab').addEventListener('click', () => flint.send('tabs:new'));
$('btn-menu').addEventListener('click', () => { closeShieldPanel(); flint.send('menu:popup'); });
$('btn-downloads').addEventListener('click', () => flint.send('downloads:open'));
$('btn-zoom').addEventListener('click', () => flint.send('tabs:zoom-reset'));
$('btn-star').addEventListener('click', async () => {
  const starred = await flint.invoke('tab:star');
  showToast(starred ? 'Bookmark added' : 'Bookmark removed');
});
$('btn-shield').addEventListener('click', () => {
  if (shieldPanel.hidden) openShieldPanel();
  else closeShieldPanel();
});
$('win-min').addEventListener('click', () => flint.send('win:ctl', 'min'));
$('win-max').addEventListener('click', () => flint.send('win:ctl', 'max'));
$('win-close').addEventListener('click', () => flint.send('win:ctl', 'close'));

/* ---------- toast ---------- */
function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  syncOverlay();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; syncOverlay(); }, 2200);
}

/* ---------- main -> chrome events ---------- */
let features = {};
flint.on('chrome:init', (init) => {
  document.body.classList.toggle('incognito', !!init.incognito);
  $('incog-badge').hidden = !init.incognito;
  features = init.features || {};
  // Grabber button exists only in editions with the media grabber.
  $('btn-grabber').hidden = !features.mediaGrabber;
});

$('btn-grabber').addEventListener('click', () => flint.send('grabber:popup'));
flint.on('grabber:badge', ({ count }) => {
  const el = $('grab-count');
  $('btn-grabber').classList.toggle('active', count > 0);
  el.hidden = !count;
  el.textContent = count > 9 ? '9+' : String(count);
});
flint.on('torrents:badge', () => { /* reserved for future toolbar indicator */ });
flint.on('tabs:update', renderTabs);
flint.on('active:update', renderActive);
flint.on('chrome:focus-omni', () => { omniEditing = true; omni.focus(); omni.select(); });
flint.on('chrome:blur-omni', () => { omniEditing = false; closeSuggestions(); closeShieldPanel(); renderOmniDisplay(); });
flint.on('chrome:find-open', openFind);
flint.on('find:result', ({ matches, active }) => {
  $('find-count').textContent = matches ? `${active}/${matches}` : '0/0';
});
flint.on('downloads:badge', ({ active }) => { $('dl-dot').hidden = !active; });
flint.on('toast', ({ text }) => showToast(text));

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!shieldPanel.hidden) closeShieldPanel();
  else if (findOpen) closeFind();
});
