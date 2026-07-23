'use strict';

// Omnibox input resolution: decide whether typed text is a URL, an internal
// page, or a search query. Pure module — unit tested in test/omni.test.js.

const SEARCH_ENGINES = {
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
};

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/;
const LOCALHOST_RE = /^localhost(:\d+)?([/?#].*)?$/i;
const DOMAIN_RE = /^[a-z0-9¡-￿]([a-z0-9¡-￿-]*[a-z0-9¡-￿])?(\.[a-z0-9¡-￿]([a-z0-9¡-￿-]*[a-z0-9¡-￿])?)+(:\d+)?([/?#].*)?$/i;

function searchUrl(engineId, query) {
  const engine = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.ddg;
  return engine.url.replace('%s', encodeURIComponent(query));
}

/**
 * @returns {null | { url: string, kind: 'url'|'search'|'internal', httpsFallback?: boolean }}
 */
function resolveOmniInput(raw, engineId) {
  const text = String(raw || '').trim();
  if (!text) return null;

  if (/^flint:/i.test(text)) {
    const page = text.replace(/^flint:\/*/i, '').replace(/\/+$/, '') || 'home';
    return { url: `flint://${page}`, kind: 'internal' };
  }
  if (/^about:blank$/i.test(text)) return { url: 'about:blank', kind: 'url' };

  if (LOCALHOST_RE.test(text) || IP_RE.test(text)) {
    return { url: `http://${text}`, kind: 'url' };
  }

  if (SCHEME_RE.test(text)) {
    if (/^(https?|file|ftp|mailto|tel):/i.test(text)) return { url: text, kind: 'url' };
    return { url: searchUrl(engineId, text), kind: 'search' };
  }

  if (/\s/.test(text)) return { url: searchUrl(engineId, text), kind: 'search' };
  if (DOMAIN_RE.test(text)) {
    return { url: `https://${text}`, kind: 'url', httpsFallback: true };
  }

  return { url: searchUrl(engineId, text), kind: 'search' };
}

module.exports = { SEARCH_ENGINES, resolveOmniInput, searchUrl };
