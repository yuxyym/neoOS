// neoOS: bug fixes + real web browser. Put this file in tools/ and run from the project root:
//   node tools/apply-browser-patch.mjs
// All-or-nothing: nothing is written unless every edit matches exactly once. Run it only once.
import fs from 'node:fs';
import path from 'node:path';
const MARK = '.neoos-browser-patched';
if (fs.existsSync(MARK)) { console.log('Already patched (delete ' + MARK + ' to force).'); process.exit(0); }

/* ---------------- new app: applications/browser ---------------- */
const NEW_FILES = {
'applications/browser/manifest.json': String.raw`{
  "id": "org.neoos.browser",
  "name": "Browser",
  "version": "1.0.0",
  "description": "Browse the web with a real Chromium view (no iframe or CORS limits)",
  "icon": "icon.svg",
  "main": "main.js",
  "minApiVersion": "1.0",
  "categories": ["Internet"],
  "permissions": ["browser"],
  "network": [],
  "instance": "multi",
  "autostart": false,
  "exitWhenLastWindowCloses": true,
  "associations": [],
  "intents": [],
  "contributes": {}
}
`,
'applications/browser/icon.svg': String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="#2f7fd8"/><g fill="none" stroke="#fff" stroke-width="3"><ellipse cx="32" cy="32" rx="11" ry="26"/><path d="M6 32h52M10 18h44M10 46h44"/></g></svg>
`,
'applications/browser/main.js': String.raw`// Browser process. The page itself is a native Chromium view owned by the host (see os/kernel.js "browser.*"),
// so sites load exactly as in a normal browser: no iframe, X-Frame-Options or CORS restrictions.
const START = 'https://duckduckgo.com/';
const HOST = /^(localhost|(\d{1,3}\.){3}\d{1,3}|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i;
function toUrl(input) {
  const s = String(input || '').trim(); if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && HOST.test(s)) return (/^(localhost|\d)/i.test(s) ? 'http://' : 'https://') + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}
neo.window.create({ title: 'Browser', width: 1100, height: 720, minWidth: 480, minHeight: 320, content: { file: 'view.html' } }).then(async w => {
  let id = null;
  neo.on('browser:state', s => { w.setTitle(s.title ? s.title + ' - Browser' : 'Browser'); w.postMessage(s); });
  w.on('message', async m => {
    if (id == null) return;
    try {
      if (m.go) { const u = toUrl(m.go); if (u) await neo.browser.navigate(id, u); }
      else if (m.action) await neo.browser.action(id, m.action);
    } catch (e) { await neo.dialog.alert({ title: 'Browser error', message: (e.code || 'ERROR') + ': ' + e.message }); }
  });
  try { id = await neo.browser.open({ wid: w.id, top: 44, url: START }); }
  catch (e) { await neo.dialog.alert({ title: 'Browser unavailable', message: e.message }); }
});
`,
'applications/browser/view.html': String.raw`<style>
body{height:100vh;overflow:hidden}
.bar{display:flex;align-items:center;gap:6px;height:44px;padding:0 8px;background:var(--neo-surface-0);border-bottom:1px solid var(--neo-border)}
.bar input{flex:1}.msg{display:grid;place-items:center;height:calc(100vh - 44px)}
</style>
<form class="bar" id="f">
  <button type="button" id="back" class="neo-btn neo-btn--ghost neo-btn--icon" title="Back" aria-label="Back" disabled>&#8249;</button>
  <button type="button" id="fwd" class="neo-btn neo-btn--ghost neo-btn--icon" title="Forward" aria-label="Forward" disabled>&#8250;</button>
  <button type="button" id="reload" class="neo-btn neo-btn--ghost neo-btn--icon" title="Reload" aria-label="Reload">&#10227;</button>
  <input id="url" class="neo-input" placeholder="Search or enter address" aria-label="Address" autocomplete="off" spellcheck="false">
</form>
<div class="msg u-muted">Loading&hellip;</div>
<script>
const $=id=>document.getElementById(id),send=m=>neoWindow.postMessage(m);let loading=false;
$('back').onclick=()=>send({action:'back'});$('fwd').onclick=()=>send({action:'forward'});
$('reload').onclick=()=>send({action:loading?'stop':'reload'});
$('f').onsubmit=e=>{e.preventDefault();send({go:$('url').value})};
$('url').onfocus=()=>$('url').select();
addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='l'){e.preventDefault();$('url').focus()}});
neoWindow.onMessage(s=>{loading=!!s.loading;$('back').disabled=!s.canBack;$('fwd').disabled=!s.canForward;
 $('reload').innerHTML=loading?'&#10005;':'&#10227;';$('reload').title=loading?'Stop':'Reload';
 if(document.activeElement!==$('url')&&s.url)$('url').value=s.url});
</script>
`,
};

/* ---------------- edits to existing files ---------------- */
const J = "['aqua','classic','dark','light']";
const PATCHES = [
  /* ===== browser: host side (Electron main process) ===== */
  { file: 'electron/main.js', edits: [
    ["const { app, BrowserWindow, ipcMain, protocol, shell, Menu, session } = require('electron');",
     "const { app, BrowserWindow, ipcMain, protocol, shell, Menu, session, WebContentsView } = require('electron');"],
    ["win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });",
     "win.webContents.on('will-navigate', (e, legacy) => { if (!String(e.url || legacy || '').startsWith(ORIGIN)) e.preventDefault(); });"],
    ["win.on('closed', () => { win = null; pty.killAll(); });",
     "win.on('closed', () => { dropAllViews(); win = null; pty.killAll(); });"],
    ['/* ---- window and app protocol ---- */', String.raw`/* ---- built-in web browser: real Chromium views (WebContentsView), so no iframe / X-Frame-Options / CORS limits ---- */
const BROWSER_PARTITION = 'persist:neoos-browser'; // separate cookie jar and storage, isolated from neoOS itself
const views = new Map(); let nextViewId = 1, browserSessionReady = false;
const webUrl = u => { try { const p = new URL(String(u)); return p.protocol === 'https:' || p.protocol === 'http:'; } catch { return false; } };
function viewState(v) {
  const wc = v.webContents, h = wc.navigationHistory || wc;
  return { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: h.canGoBack(), canForward: h.canGoForward() };
}
function dropView(id) {
  const v = views.get(id); if (!v) return; views.delete(id);
  try { win && !win.isDestroyed() && win.contentView.removeChildView(v); } catch {}
  try { if (!v.webContents.isDestroyed()) v.webContents.close(); } catch {}
}
function dropAllViews() { [...views.keys()].forEach(dropView); }
const getView = id => { const v = views.get(Number(id)); if (!v) throw E('ENOENT', 'No such browser view'); return v; };
handle('browser:create', (e, o = {}) => {
  if (!win) throw E('EIO', 'No window');
  if (!browserSessionReady) {
    browserSessionReady = true;
    const ses = session.fromPartition(BROWSER_PARTITION);
    ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
    ses.setPermissionCheckHandler((wc, perm) => perm === 'clipboard-sanitized-write');
  }
  const view = new WebContentsView({ webPreferences: { partition: BROWSER_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
  const id = nextViewId++, wc = view.webContents;
  views.set(id, view);
  win.contentView.addChildView(view); view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); view.setVisible(false);
  const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };
  const push = () => { if (!wc.isDestroyed()) send('browser:state', id, viewState(view)); };
  for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-fail-load']) wc.on(ev, push);
  wc.on('focus', () => send('browser:focus', id));
  wc.setWindowOpenHandler(({ url }) => { if (webUrl(url)) wc.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  const guard = (ev, legacy) => { const u = ev.url || legacy; if (!webUrl(u) && u !== 'about:blank') ev.preventDefault(); };
  wc.on('will-navigate', guard); wc.on('will-redirect', guard);
  if (o.url && webUrl(o.url)) wc.loadURL(o.url).catch(() => {});
  return id;
});
handle('browser:navigate', (e, id, url) => {
  if (!webUrl(url)) throw E('EINVAL', 'Only http and https addresses can be opened');
  getView(id).webContents.loadURL(String(url)).catch(() => {});
});
handle('browser:action', (e, id, a) => {
  const wc = getView(id).webContents, nav = wc.navigationHistory || wc;
  if (a === 'back' && nav.canGoBack()) nav.goBack();
  else if (a === 'forward' && nav.canGoForward()) nav.goForward();
  else if (a === 'reload') wc.reload();
  else if (a === 'stop') wc.stop();
});
handle('browser:bounds', (e, id, b = {}) => {
  const v = getView(id), r = { x: Math.round(b.x) || 0, y: Math.round(b.y) || 0, width: Math.max(0, Math.round(b.width) || 0), height: Math.max(0, Math.round(b.height) || 0) };
  v.setBounds(r); v.setVisible(!!b.visible && r.width > 0 && r.height > 0);
});
handle('browser:destroy', (e, id) => dropView(Number(id)));

/* ---- window and app protocol ---- */`],
  ] },
  { file: 'electron/preload.js', edits: [
    ["'pty:spawn', 'pty:write', 'pty:resize', 'pty:kill']);",
     "'pty:spawn', 'pty:write', 'pty:resize', 'pty:kill', 'browser:create', 'browser:navigate', 'browser:action', 'browser:bounds', 'browser:destroy']);"],
    ["const EVENTS = new Set(['pty:data', 'pty:exit']);", "const EVENTS = new Set(['pty:data', 'pty:exit', 'browser:state', 'browser:focus']);"],
  ] },

  /* ===== browser: kernel (permission-checked syscalls + keeping native views glued to their windows) ===== */
  { file: 'os/kernel.js', edits: [
    ["wm.hooks.onClose = w => { const p = procs.get(w.pid); if (!p) return;",
     String.raw`host.on('browser:state', (id, st) => { const v = bviews.get(id), p = v && procs.get(v.pid); p && send(p, 'browser:state', { id, ...st }); });
  host.on('browser:focus', id => { const v = bviews.get(id); v && wm.focus(v.w); });
  wm.hooks.onClose = w => { dropWindowViews(w.id); const p = procs.get(w.pid); if (!p) return;`],
    ["for (const [id, owner] of ptyOwner) if (owner === pid)", "dropViewsOf(pid);\n  for (const [id, owner] of ptyOwner) if (owner === pid)"],
    ['const S = {', String.raw`// Native browser views (Electron WebContentsView) float above the DOM. The kernel keeps each one glued to the body of its
// owning window and hides it while it is covered by another window, a menu, the launcher or a dialog.
const bviews = new Map(); let bframe = 0;
const zOf = w => parseFloat(w.el.style.zIndex) || 0;
const ownView = (p, id) => { const v = bviews.get(id); if (!v || v.pid !== p.pid) throw new NeoError('EPERM', 'No such browser view'); return id; };
function dropView(id) { if (bviews.delete(id)) host.call('browser:destroy', id).catch(() => {}); }
function dropViewsOf(pid) { [...bviews].forEach(([id, v]) => v.pid === pid && dropView(id)); }
function dropWindowViews(wid) { [...bviews].forEach(([id, v]) => v.w.id === wid && dropView(id)); }
const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function syncViews() {
  const overlay = !!document.querySelector('.neo-launcher,.neo-ctx,.neo-lock,[role=alertdialog],[role=dialog]');
  for (const [id, v] of bviews) {
    const w = v.w, r = w.el.querySelector('.neo-win__body').getBoundingClientRect(), inset = 4; // inset keeps the window resize handles usable
    const b = { x: Math.round(r.left + inset), y: Math.round(r.top + v.top), width: Math.max(0, Math.round(r.width - 2 * inset)), height: Math.max(0, Math.round(r.height - v.top - inset)) };
    const box = { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
    let visible = !overlay && !w.min && !w.el.hidden && !w.el.classList.contains('is-closing') && !w.el.classList.contains('is-minimizing');
    if (visible) for (const o of wm.list()) if (o !== w && !o.min && !o.el.hidden && zOf(o) > zOf(w) && hit(box, o.el.getBoundingClientRect())) { visible = false; break; }
    const key = [b.x, b.y, b.width, b.height, visible].join();
    if (key !== v.last) { v.last = key; host.call('browser:bounds', id, { ...b, visible }).catch(() => {}); }
  }
}
function pumpViews() {
  if (bframe) return;
  const tick = () => { if (!bviews.size) { bframe = 0; return; } try { syncViews(); } catch {} bframe = requestAnimationFrame(tick); };
  bframe = requestAnimationFrame(tick);
}

const S = {`],
    ["'pty.spawn': { scope: 'pty',", String.raw`'browser.open': { scope: 'browser', fn: async (p, o = {}) => {
    const w = own(p, o.wid), id = await host.call('browser:create', { url: o.url ? String(o.url) : undefined });
    bviews.set(id, { pid: p.pid, w, top: Math.max(0, Number(o.top) || 0), last: '' }); pumpViews(); return id;
  } },
  'browser.navigate': { scope: 'browser', fn: (p, id, url) => host.call('browser:navigate', ownView(p, id), String(url)) },
  'browser.action': { scope: 'browser', fn: (p, id, a) => host.call('browser:action', ownView(p, id), String(a)) },
  'browser.close': { scope: 'browser', fn: (p, id) => { dropView(ownView(p, id)); } },
  'pty.spawn': { scope: 'pty',`],
  ] },
  { file: 'os/apps.index.json', edits: [['"task-manager"]', '"task-manager", "browser"]']] },
  { file: 'os/shell.js', edits: [
    ["const DEFAULT_DOCK = ['org.neoos.file-manager',", "const DEFAULT_DOCK = ['org.neoos.browser', 'org.neoos.file-manager',"],
    ["const DESKTOP_ICONS = ['org.neoos.file-manager',", "const DESKTOP_ICONS = ['org.neoos.browser', 'org.neoos.file-manager',"],
    /* bug: the quick-settings theme picker was dead (only the "metro" look exists) */
    [/^[ \t]*const themeRow = .*\n/m, ''],
    ['m.append(head, themeRow, soundRow,', 'm.append(head, soundRow,'],
  ] },

  /* ===== bug fixes ===== */
  { file: 'applications/settings/view.html', edits: [ // dead theme buttons
    [/[ \t]*<article class="neo-card panel"><h2>Theme<\/h2>[\s\S]*?<\/article>\n?/, ''],
    [J + ".forEach(t=>$(t).onclick=()=>post({theme:t}));", ''],
    [J + ".forEach(t=>$(t).classList.toggle('is-active',d.theme===t));", ''],
  ] },
  { file: 'index.html', edits: [['<html lang="en" data-theme="dark">', '<html lang="en" data-theme="metro">']] }, // boot screen flashed the dark theme
  { file: 'applications/calculator/view.html', edits: [ // typing a digit after "=" appended to the result
    ["let ex='';const $=", "let ex='',fresh=false;const $="],
    ["if(ex==='Error')ex='';", "if(ex==='Error')ex='';const was=fresh;fresh=false;"],
    ["ex=evaluate(ex||'0')}catch", "ex=evaluate(ex||'0');fresh=true}catch"],
    [" else ex+=k;show()}", " else{if(was&&/[\\d.(]/.test(k))ex='';ex+=k}show()}"],
  ] },
];

const texts = new Map(); let failed = false;
for (const p of PATCHES) {
  if (!fs.existsSync(p.file)) { console.error('Missing file: ' + p.file); failed = true; continue; }
  let text = texts.get(p.file) ?? fs.readFileSync(p.file, 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to] of p.edits) {
    const n = from instanceof RegExp ? (from.test(text) ? 1 : 0) : text.split(from).length - 1;
    if (n === 1) text = text.replace(from, () => to);
    else if (n === 0 && (from instanceof RegExp || (to && text.includes(to)))) console.log('  (already applied) ' + p.file);
    else { console.error(p.file + ': expected exactly 1 match, found ' + n + ' for: ' + String(from).slice(0, 70)); failed = true; }
  }
  texts.set(p.file, text);
}
if (failed) { console.error('\nNo files were changed.'); process.exit(1); }
for (const [f, t] of texts) { fs.writeFileSync(f, t); console.log('patched ' + f); }
for (const [f, t] of Object.entries(NEW_FILES)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); console.log('created ' + f); }
fs.writeFileSync(MARK, 'neoOS browser patch applied\n');
console.log('\nDone. Restart with: npm start');
