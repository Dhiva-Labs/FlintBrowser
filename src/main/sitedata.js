'use strict';

// Per-site reset: cookies for the whole registrable domain (youtube.com also
// covers m.youtube.com, music.youtube.com, ...) plus the current origin's
// storage. Used by the shield panel's "Clear cookies & site data".

const { parse } = require('tldts-experimental');

const STORAGES = ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'shadercache', 'websql'];

/** @returns {Promise<string|null>} the cleared site, or null if `url` is not a web page */
async function clearSiteData(ses, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const site = parse(u.hostname).domain || u.hostname;

  // cookies.get({ domain }) only returns cookies that would be *sent to* that
  // domain, missing subdomain cookies (www.youtube.com), so filter ourselves.
  const cookies = (await ses.cookies.get({})).filter((c) => {
    const d = c.domain.replace(/^\./, '');
    return d === site || d.endsWith('.' + site);
  });
  await Promise.all(cookies.map((c) => {
    const host = c.domain.replace(/^\./, '');
    return ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`, c.name).catch(() => { });
  }));
  await ses.clearStorageData({ origin: u.origin, storages: STORAGES });
  return site;
}

module.exports = { clearSiteData };
