'use strict';
// Thin wrapper around main.js: browser snapshots, window-manager shortcuts, system control IPC, app subprocesses and --session (kiosk OS) mode.
const { app, ipcMain, session } = require('electron');
const PART = 'persist:neoos-browser', ORIGIN = 'neoos://app/', SESSION = process.argv.includes('--session');
const realHandle = ipcMain.handle.bind(ipcMain), snaps = new Map();
let lastView = null, quitting = false;
ipcMain.handle = (ch, fn) => ch !== 'browser:create' ? realHandle(ch, fn) : realHandle(ch, async (e, ...a) => {
  lastView = null; const r = await fn(e, ...a);
  if (r && r.ok && lastView) snaps.set(r.result, lastView);
  return r;
});
app.on('web-contents-created', (_e, wc) => {
  try { if (wc.session === session.fromPartition(PART)) { lastView = wc; wc.once('destroyed', () => { for (const [k, v] of snaps) if (v === wc) snaps.delete(k); }); } } catch {}
});
realHandle('browser:snapshot', async (e, id) => {
  if (!e.senderFrame || !e.senderFrame.url.startsWith(ORIGIN)) return { ok: false, error: { code: 'EACCES', message: 'Untrusted sender' } };
  const wc = snaps.get(Number(id));
  if (!wc || wc.isDestroyed()) return { ok: true, result: null };
  try {
    let img = await wc.capturePage(); if (img.isEmpty()) return { ok: true, result: null };
    if (img.getSize().width > 1600) img = img.resize({ width: 1600 });
    return { ok: true, result: 'data:image/jpeg;base64,' + img.toJPEG(75).toString('base64') };
  } catch { return { ok: true, result: null }; }
});
app.on('before-quit', () => { quitting = true; });
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('before-input-event', (ev, i) => {
    if (i.type !== 'keyDown') return;
    const k = String(i.key || '').toLowerCase(); let n = null;
    if (i.control && i.alt && !i.meta) n = { t: 'terminal', e: 'files', b: 'browser', l: 'lock', d: 'desktop', arrowright: 'next', arrowleft: 'prev' }[k];
    else if (i.control && i.shift && k === 'escape') n = 'taskmgr';
    else if (i.alt && !i.control && k === 'tab') n = 'next';
    if (n) { ev.preventDefault(); w.webContents.send('shell:shortcut', n); }
  });
  if (SESSION) { // neoOS owns the screen: kiosk, cannot be closed or un-fullscreened, no devtools
    w.once('ready-to-show', () => w.setKiosk(true));
    w.on('leave-full-screen', () => setTimeout(() => !w.isDestroyed() && w.setFullScreen(true), 50));
    w.on('close', ev => { if (!quitting) ev.preventDefault(); });
    w.webContents.on('devtools-opened', () => w.webContents.closeDevTools());
  }
});
require('./system.js');
require('./procs.js');
require('./main.js');
