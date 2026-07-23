'use strict';

// Secure DNS (DNS-over-HTTPS) via Chromium's built-in resolver.

const PROVIDERS = {
  cloudflare: { name: 'Cloudflare (1.1.1.1)', url: 'https://cloudflare-dns.com/dns-query' },
  quad9: { name: 'Quad9 (9.9.9.9)', url: 'https://dns.quad9.net/dns-query' },
  google: { name: 'Google (8.8.8.8)', url: 'https://dns.google/dns-query' },
  adguard: { name: 'AdGuard DNS', url: 'https://dns.adguard-dns.com/dns-query' },
};

function apply(app, doh) {
  const mode = doh && doh.mode ? doh.mode : 'automatic';
  const cfg = { secureDnsMode: 'automatic', secureDnsServers: [] };
  if (mode === 'off') {
    cfg.secureDnsMode = 'off';
  } else if (mode === 'secure' || mode === 'automatic') {
    cfg.secureDnsMode = mode;
    const url = doh.provider === 'custom'
      ? (doh.customUrl || '').trim()
      : (PROVIDERS[doh.provider] || PROVIDERS.cloudflare).url;
    if (url) cfg.secureDnsServers = [url];
    else cfg.secureDnsMode = 'automatic';
  }
  try {
    app.configureHostResolver(cfg);
    return true;
  } catch (err) {
    console.error('[doh] configureHostResolver failed:', err.message);
    return false;
  }
}

module.exports = { PROVIDERS, apply };
