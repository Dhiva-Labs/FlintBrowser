'use strict';

// Preload for tab contents. Exposes the internal-pages API; the main process
// rejects every one of these calls unless the sender frame is a flint:// page,
// so exposure to ordinary web pages is inert.

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'pages:boot', 'pages:set-settings',
  'pages:history', 'pages:history-delete', 'pages:history-clear',
  'pages:bookmarks', 'pages:bookmark-delete',
  'pages:downloads', 'pages:download-action', 'pages:downloads-clear',
  'pages:top-sites', 'pages:navigate', 'pages:reader-get',
  'pages:set-default', 'pages:clear-data', 'pages:choose-download-dir',
  'pages:torrents', 'pages:torrent-add', 'pages:torrent-action',
]);

contextBridge.exposeInMainWorld('flintPages', {
  invoke: (channel, ...args) => (INVOKE.has(channel)
    ? ipcRenderer.invoke(channel, ...args)
    : Promise.reject(new Error('channel not allowed'))),
});
