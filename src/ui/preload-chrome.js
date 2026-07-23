'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set([
  'omni:resolve', 'omni:navigate', 'tabs:new', 'tabs:close', 'tabs:activate', 'tabs:reopen',
  'nav:go', 'find:start', 'find:stop', 'chrome:overlay', 'win:ctl', 'menu:popup', 'downloads:open',
]);
const INVOKE = new Set(['omni:suggest', 'tab:star', 'shield:info', 'shield:toggle-site']);
const ON = new Set([
  'chrome:init', 'chrome:maximized', 'chrome:focus-omni', 'chrome:blur-omni', 'chrome:find-open',
  'tabs:update', 'active:update', 'find:result', 'downloads:badge', 'toast',
]);

contextBridge.exposeInMainWorld('flint', {
  send: (channel, ...args) => { if (SEND.has(channel)) ipcRenderer.send(channel, ...args); },
  invoke: (channel, ...args) => (INVOKE.has(channel)
    ? ipcRenderer.invoke(channel, ...args)
    : Promise.reject(new Error('channel not allowed'))),
  on: (channel, cb) => {
    if (ON.has(channel)) ipcRenderer.on(channel, (event, payload) => cb(payload));
  },
});
