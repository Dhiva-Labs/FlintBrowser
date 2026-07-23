'use strict';

// Media grabber (Flint Plus only).
//
// Detects *direct, unencrypted* media files a page loads — the same thing a
// download manager like IDM does — and offers to download them. It deliberately
// does NOT defeat any content protection:
//   * DRM/EME streams are never targeted (DASH manifests are ignored, and the
//     big protected streaming services are blocklisted outright).
//   * It only surfaces whole media files and HLS playlists that the site
//     already served in the clear; it does not reconstruct protected streams.
// This keeps the feature on the defensible "save a plain video file" side of
// the line rather than the "circumvent a technological protection measure" side.

const path = require('path');

// Protected / ToS-sensitive services whose media we never surface. This is the
// guardrail that keeps the grabber away from things like YouTube's rolling
// cipher and Widevine-protected catalogues.
const STREAMING_BLOCKLIST = [
  'youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'youtube-nocookie.com',
  'netflix.com', 'nflxvideo.net', 'nflximg.net',
  'spotify.com', 'scdn.co', 'spotifycdn.com',
  'hulu.com', 'disneyplus.com', 'disney-plus.net', 'dssott.com',
  'primevideo.com', 'aiv-cdn.net', 'media-amazon.com',
  'max.com', 'hbomax.com', 'hbo.com',
  'peacocktv.com', 'nbcuni.com',
  'twitch.tv', 'ttvnw.net',
  'crunchyroll.com', 'vrv.co',
  'appletv.apple.com', 'play.itunes.apple.com',
];

const MEDIA_EXT = new Set([
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv',
  'm4a', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'weba',
  'm3u8', // HLS playlist (clear)
]);
// Streaming *segments* — never listed individually (there can be thousands).
const SEGMENT_EXT = new Set(['ts', 'm4s']);

const HLS_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];
const MIN_DIRECT_SIZE = 100 * 1024; // ignore tiny files (thumbnails, sprites)

function hostBlocked(host) {
  host = (host || '').toLowerCase();
  return STREAMING_BLOCKLIST.some((h) => host === h || host.endsWith('.' + h));
}

function extOf(pathname) {
  const base = pathname.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Decide whether a response is grabbable media.
 * @returns {null | { url, name, kind: 'video'|'audio'|'hls', ext, contentType, size }}
 */
function classify(url, contentType = '', size = 0) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (hostBlocked(u.hostname)) return null;

  const ct = String(contentType).split(';')[0].trim().toLowerCase();
  if (ct === 'application/dash+xml') return null; // DASH is DRM-prone — never target

  const ext = extOf(u.pathname);
  if (SEGMENT_EXT.has(ext)) return null;

  const isHls = ext === 'm3u8' || HLS_TYPES.includes(ct);
  const isVideo = ct.startsWith('video/') || ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv'].includes(ext);
  const isAudio = ct.startsWith('audio/') || ['m4a', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'weba'].includes(ext);

  if (!isHls && !isVideo && !isAudio) {
    if (!MEDIA_EXT.has(ext)) return null;
  }
  // Whole direct files below the threshold are almost always sprites/segments.
  if (!isHls && size && size < MIN_DIRECT_SIZE) return null;

  const kind = isHls ? 'hls' : (isAudio && !isVideo ? 'audio' : 'video');
  let name = decodeURIComponent((u.pathname.split('/').pop() || '')).trim();
  if (!name || name === '/' || !name.includes('.')) {
    name = `${u.hostname.replace(/^www\./, '')}.${ext || (kind === 'audio' ? 'mp3' : 'mp4')}`;
  }
  return { url, name, kind, ext, contentType: ct, size: size || 0 };
}

class MediaGrabber {
  constructor() {
    this.perTab = new Map(); // webContentsId -> Map(url -> item)
    this.onFound = null; // (webContentsId, count) => void
  }

  attach(ses) {
    ses.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
      try {
        if (details.statusCode >= 300 || !details.webContentsId) return;
        const headers = details.responseHeaders || {};
        const get = (k) => {
          const hit = Object.keys(headers).find((h) => h.toLowerCase() === k);
          return hit ? [].concat(headers[hit])[0] : '';
        };
        const item = classify(details.url, get('content-type'), parseInt(get('content-length') || '0', 10));
        if (!item) return;
        let bucket = this.perTab.get(details.webContentsId);
        if (!bucket) { bucket = new Map(); this.perTab.set(details.webContentsId, bucket); }
        if (bucket.has(item.url)) return;
        if (bucket.size >= 60) return; // sanity cap per tab
        bucket.set(item.url, item);
        if (this.onFound) this.onFound(details.webContentsId, bucket.size);
      } catch { /* ignore malformed */ }
    });
  }

  list(wcId) {
    const bucket = this.perTab.get(wcId);
    return bucket ? [...bucket.values()] : [];
  }

  count(wcId) {
    const bucket = this.perTab.get(wcId);
    return bucket ? bucket.size : 0;
  }

  clear(wcId) {
    this.perTab.delete(wcId);
  }
}

module.exports = { MediaGrabber, classify, hostBlocked, STREAMING_BLOCKLIST };
