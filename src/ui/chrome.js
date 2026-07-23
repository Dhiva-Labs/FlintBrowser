'use strict';
/* global flint */

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const omni = $('omni');
const omnibox = $('omnibox');
const omniIcon = $('omni-icon');
const sugEl = $('suggestions');
const findbar = $('findbar');
const findInput = $('find-input');
const toastEl = $('toast');

let activeInfo = null;
let suggestions = [];
let sugSel = 0;
let omniEditing = false;
let toastTimer = null;

const ICONS = {
  lock: '<svg viewBox="0 0 20 20"><rect x="4.5" y="9" width="11" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  globe: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 10h14M10 3c-4.5 4.7-4.5 9.3 0 14 4.5-4.7 4.5-9.3 0-14z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  flame: '<svg viewBox="0 0 20 20"><path d="M10 2.5c1.6 2.6 4.5 4.4 4.5 7.8A4.6 4.6 0 0 1 10 15a4.6 4.6 0 0 1-4.5-4.7c0-1.9.9-3.2 1.9-4.4-.1 1.4.4 2.2 1.2 2.6-.4-1.7 0-4 1.4-6z" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 20 20"><path d="M10 3.5l7.5 13h-15z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8.5v3.5m0 2v.5" stroke="currentColor" stroke-width="1.5"/></svg>',
};

/* ---------- overlay height coordination ---------- */
function syncOverlay() {
  let h = 0;
  if (!sugEl.hidden) h = Math.max(h, sugEl.offsetHeight + 12);
  if (!findbar.hidden) h = Math.max(h, findbar.offsetHeight + 12);
  if (!toastEl.hidden) h = Math.max(h, toastEl.offsetHeight + 16);
  flint.send('chrome:overlay', h);
}

/* ---------- tabs ---------- */
function letterOf(t) {
  try {
    if (t.internal) return null;
    const host = new URL(t.url).hostname.replace(/^www\./, '');
    return (host[0] || '?').toUpperCase();
  } catch { return '?'; }
}

function renderTabs(tabs) {
  tabsEl.textContent = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.active ? ' active' : '');
    el.title = t.title;

    let fav;
    if (t.loading) {
      fav = document.createElement('div');
      fav.className = 'fav spin';
    } else if (t.internal) {
      fav = document.createElement('div');
      fav.className = 'fav';
      fav.innerHTML = ICONS.flame;
      fav.style.color = 'var(--accent)';
    } else if (t.favicon) {
      fav = document.createElement('img');
      fav.className = 'fav';
      fav.src = t.favicon;
      fav.onerror = () => { fav.replaceWith(makeLetter(t)); };
    } else {
      fav = makeLetter(t);
    }
    el.appendChild(fav);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || 'New Tab';
    el.appendChild(title);

    if (t.blocked > 0) {
      const pill = document.createElement('span');
      pill.className = 'blocked-pill';
      pill.textContent = t.blocked > 99 ? '99+' : String(t.blocked);
      pill.title = `${t.blocked} ads/trackers blocked`;
      el.appendChild(pill);
    }

    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); flint.send('tabs:close', t.id); });
    el.appendChild(close);

    el.addEventListener('click', () => flint.send('tabs:activate', t.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) flint.send('tabs:close', t.id); });
    tabsEl.appendChild(el);
  }
  const activeEl = tabsEl.querySelector('.tab.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function makeLetter(t) {
  const d = document.createElement('div');
  d.className = 'fav letter';
  d.textContent = letterOf(t) || '·';
  return d;
}

/* ---------- active tab / omnibox ---------- */
function displayUrl(url) {
  if (!url || url === 'flint://home') return '';
  return url;
}

function renderActive(info) {
  activeInfo = info;
  $('btn-back').disabled = !info.canBack;
  $('btn-fwd').disabled = !info.canFwd;
  $('ic-reload').hidden = info.loading;
  $('ic-stop').hidden = !info.loading;
  $('btn-star').classList.toggle('starred', !!info.starred);
  $('btn-star').style.display = /^https?:/.test(info.url) ? '' : 'none';

  if (!omniEditing) omni.value = displayUrl(info.url);

  if (info.internal) { omniIcon.innerHTML = ICONS.flame; omniIcon.className = 'internal'; omniIcon.title = 'Flint page'; }
  else if (info.url.startsWith('https:')) { omniIcon.innerHTML = ICONS.lock; omniIcon.className = 'secure'; omniIcon.title = 'Secure connection'; }
  else if (info.url.startsWith('http:')) { omniIcon.innerHTML = ICONS.warn; omniIcon.className = ''; omniIcon.title = 'Not secure'; }
  else { omniIcon.innerHTML = ICONS.globe; omniIcon.className = ''; omniIcon.title = ''; }

  const count = $('shield-count');
  count.hidden = !(info.blocked > 0);
  count.textContent = info.blocked > 99 ? '99+' : String(info.blocked);
}

/* ---------- suggestions ---------- */
const SUG_ICON = { search: '🔍', history: '🕘', bookmark: '★', url: '→' };

function renderSuggestions() {
  sugEl.textContent = '';
  if (!suggestions.length) { sugEl.hidden = true; syncOverlay(); return; }
  suggestions.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sug' + (i === sugSel ? ' sel' : '');
    const ic = document.createElement('span'); ic.className = 'si'; ic.textContent = SUG_ICON[s.type] || '·';
    const tx = document.createElement('span'); tx.className = 'st'; tx.textContent = s.text;
    row.appendChild(ic); row.appendChild(tx);
    if (s.detail) { const d = document.createElement('span'); d.className = 'sd'; d.textContent = s.detail; row.appendChild(d); }
    row.addEventListener('mousedown', (e) => { e.preventDefault(); acceptSuggestion(i); });
    row.addEventListener('mousemove', () => { if (sugSel !== i) { sugSel = i; renderSuggestions(); } });
    sugEl.appendChild(row);
  });
  sugEl.hidden = false;
  syncOverlay();
}

function closeSuggestions() {
  suggestions = []; sugSel = 0;
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
  clearTimeout(sugTimer);
  const text = omni.value;
  if (!text.trim()) { closeSuggestions(); return; }
  sugTimer = setTimeout(async () => {
    try {
      suggestions = await flint.invoke('omni:suggest', text);
      sugSel = 0;
      renderSuggestions();
    } catch { /* ignore */ }
  }, 120);
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
    omniEditing = false;
    closeSuggestions();
    omni.value = activeInfo ? displayUrl(activeInfo.url) : '';
    omni.blur();
    flint.send('find:stop', true); // refocuses the page
  }
});

omni.addEventListener('focus', () => { omnibox.classList.add('focused'); requestAnimationFrame(() => omni.select()); });
omni.addEventListener('blur', () => {
  omnibox.classList.remove('focused');
  setTimeout(() => { if (document.activeElement !== omni) { omniEditing = false; closeSuggestions(); } }, 80);
});

/* ---------- find bar ---------- */
let findOpen = false;
function openFind() {
  findOpen = true;
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

/* ---------- toolbar buttons ---------- */
$('btn-back').addEventListener('click', () => flint.send('nav:go', 'back'));
$('btn-fwd').addEventListener('click', () => flint.send('nav:go', 'forward'));
$('btn-reload').addEventListener('click', () => flint.send('nav:go', activeInfo && activeInfo.loading ? 'stop' : 'reload'));
$('btn-home').addEventListener('click', () => flint.send('nav:go', 'home'));
$('btn-newtab').addEventListener('click', () => flint.send('tabs:new'));
$('btn-menu').addEventListener('click', () => flint.send('menu:popup'));
$('btn-downloads').addEventListener('click', () => flint.send('downloads:open'));
$('btn-star').addEventListener('click', async () => {
  const starred = await flint.invoke('tab:star');
  showToast(starred ? 'Bookmark added' : 'Bookmark removed');
});
$('btn-shield').addEventListener('click', async () => {
  const info = await flint.invoke('shield:info');
  if (!info.host) { showToast(info.enabled ? 'Ad blocking is on' : 'Ad blocking is off'); return; }
  const allowed = await flint.invoke('shield:toggle-site');
  if (allowed === null) return;
  showToast(allowed ? `Ad blocking disabled on ${info.host}` : `Ad blocking enabled on ${info.host}`);
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
flint.on('chrome:blur-omni', () => { omniEditing = false; closeSuggestions(); });
flint.on('chrome:find-open', openFind);
flint.on('find:result', ({ matches, active }) => {
  $('find-count').textContent = matches ? `${active}/${matches}` : '0/0';
});
flint.on('downloads:badge', ({ active }) => { $('dl-dot').hidden = !active; });
flint.on('toast', ({ text }) => showToast(text));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && findOpen) closeFind();
});
