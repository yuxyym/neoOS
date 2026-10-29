'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const CALLS = new Set(['fs:list', 'fs:read', 'fs:write', 'fs:mkdir', 'fs:remove', 'fs:move', 'fs:copy', 'host:paths', 'host:info', 'host:stats', 'host:processes', 'host:kill', 'host:open', 'host:disk', 'host:quit', 'pty:spawn', 'pty:write', 'pty:resize', 'pty:kill', 'browser:create', 'browser:navigate', 'browser:action', 'browser:bounds', 'browser:destroy']);
const EVENTS = new Set(['pty:data', 'pty:exit', 'browser:state', 'browser:focus']);
// Only the kernel (main page) can reach this; app sandboxes go through permission-checked syscalls.
contextBridge.exposeInMainWorld('neoHost', {
  call: (channel, ...args) => CALLS.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('Blocked channel: ' + channel)),
  on: (channel, fn) => { if (!EVENTS.has(channel)) return () => {}; const h = (_e, ...a) => fn(...a); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); },
});
