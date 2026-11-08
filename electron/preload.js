'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const CALLS = new Set(['fs:list', 'fs:read', 'fs:write', 'fs:mkdir', 'fs:remove', 'fs:move', 'fs:copy', 'host:paths', 'host:info', 'host:stats', 'host:processes', 'host:kill', 'host:open', 'host:disk', 'host:quit', 'host:apps', 'pty:spawn', 'pty:write', 'pty:resize', 'pty:kill', 'browser:create', 'browser:navigate', 'browser:action', 'browser:bounds', 'browser:destroy', 'browser:snapshot', 'sys:call', 'proc:spawn', 'ui:zoom']);
const POSTS = new Set(['proc:send', 'proc:kill']); // fire-and-forget (no reply): the hot app <-> kernel message path
const EVENTS = new Set(['pty:data', 'pty:exit', 'browser:state', 'browser:focus', 'shell:shortcut', 'proc:msg', 'proc:exit']);
// Only the kernel (main page) can reach this; app subprocesses go through permission-checked syscalls.
contextBridge.exposeInMainWorld('neoHost', {
  call: (channel, ...args) => CALLS.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('Blocked channel: ' + channel)),
  post: (channel, ...args) => { if (POSTS.has(channel)) ipcRenderer.send(channel, ...args); },
  on: (channel, fn) => { if (!EVENTS.has(channel)) return () => {}; const h = (_e, ...a) => fn(...a); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); },
});
