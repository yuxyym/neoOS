'use strict';
const { app, BrowserWindow, ipcMain, protocol, shell, Menu, session, WebContentsView } = require('electron');
const path = require('node:path'), fs = require('node:fs'), fsp = fs.promises, os = require('node:os');
const { execFile } = require('node:child_process');
const fsb = require('./fsbridge'), pty = require('./pty');

const ROOT = path.join(__dirname, '..'), ORIGIN = 'neoos://app/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.oga': 'audio/ogg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.docx': 'application/octet-stream', '.xlsx': 'application/octet-stream', '.pptx': 'application/octet-stream', '.md': 'text/markdown' };
protocol.registerSchemesAsPrivileged([{ scheme: 'neoos', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let win = null;
const bridge = fsb.create({ trash: h => shell.trashItem(h) });
const isWin = process.platform === 'win32';

/* ---- IPC plumbing: every call is verified to come from the neoOS page, results are enveloped so error codes survive ---- */
const trusted = e => !!win && e.sender === win.webContents && !!e.senderFrame && e.senderFrame.url.startsWith(ORIGIN);
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) return { ok: false, error: { code: 'EACCES', message: 'Untrusted sender' } };
    try { return { ok: true, result: await fn(e, ...args) }; }
    catch (err) { return { ok: false, error: { code: err.code || 'EIO', message: err.message } }; }
  });
}
const E = (code, message) => Object.assign(new Error(message), { code });

/* ---- filesystem ---- */
handle('fs:list', (e, p) => bridge.list(p));
handle('fs:read', (e, p) => bridge.read(p));
handle('fs:write', (e, p, d) => bridge.write(p, d));
handle('fs:mkdir', (e, p) => bridge.mkdir(p));
handle('fs:remove', (e, p, o) => bridge.remove(p, o));
handle('fs:move', (e, a, b) => bridge.move(a, b));
handle('fs:copy', (e, a, b) => bridge.copy(a, b));

/* ---- host information ---- */
handle('host:paths', () => {
  const out = { root: '/' };
  for (const k of ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'temp']) {
    try { const h = app.getPath(k); if (['documents', 'downloads', 'pictures'].includes(k)) fs.mkdirSync(h, { recursive: true }); out[k] = fsb.toPub(h); } catch {}
  }
  return out;
});
const freeMem = () => { if (process.platform === 'linux') { try { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) return +m[1] * 1024; } catch {} } return os.freemem(); };
handle('host:info', () => {
  const cpus = os.cpus(), u = os.userInfo();
  return { platform: process.platform, arch: process.arch, hostname: os.hostname(), osType: os.type(), release: os.release(), version: os.version ? os.version() : '', username: u.username, shell: u.shell || process.env.SHELL || process.env.COMSPEC || '', home: fsb.toPub(os.homedir()), cpu: { model: cpus[0]?.model || 'Unknown', count: cpus.length, speed: cpus[0]?.speed || 0 }, totalmem: os.totalmem(), versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8 }, terminal: pty.backend() };
});
let lastCpu = os.cpus().map(c => ({ ...c.times }));
handle('host:stats', () => {
  const now = os.cpus(), cores = now.map((c, i) => {
    const a = lastCpu[i] || c.times, b = c.times, total = Object.keys(b).reduce((s, k) => s + (b[k] - a[k]), 0);
    return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 1000) / 10 : 0;
  });
  lastCpu = now.map(c => ({ ...c.times }));
  return { cpu: cores.length ? Math.round(cores.reduce((s, c) => s + c, 0) / cores.length * 10) / 10 : 0, cores, totalmem: os.totalmem(), freemem: freeMem(), uptime: os.uptime(), loadavg: os.loadavg() };
});
handle('host:disk', async () => { const s = await fsp.statfs(os.homedir()); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; });
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (e, out) => (e ? rej(e) : res(out))));
handle('host:processes', async () => {
  if (isWin) {
    const out = await run('tasklist', ['/fo', 'csv', '/nh']);
    return out.split(/\r?\n/).filter(Boolean).map(l => { const f = (l.match(/"((?:[^"]|"")*)"/g) || []).map(s => s.slice(1, -1)); return f.length < 5 ? null : { pid: +f[1], name: f[0], cpu: 0, mem: (parseInt(f[4].replace(/\D/g, ''), 10) || 0) * 1024, user: '' }; }).filter(Boolean);
  }
  const out = await run('ps', ['-axo', 'pid=,pcpu=,rss=,user=,comm=']);
  return out.split('\n').map(l => { const m = /^\s*(\d+)\s+([\d.,]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l); return m ? { pid: +m[1], cpu: parseFloat(m[2].replace(',', '.')), mem: +m[3] * 1024, user: m[4], name: path.basename(m[5].trim()) || m[5].trim() } : null; }).filter(Boolean);
});
handle('host:kill', (e, pid) => {
  pid = Number(pid);
  if (!Number.isInteger(pid) || pid <= 1) throw E('EINVAL', 'Invalid process id');
  if (pid === process.pid) throw E('EPERM', 'Use Quit to close neoOS itself');
  process.kill(pid);
});
handle('host:open', async (e, p) => { const msg = await shell.openPath(fsb.toHost(p)); if (msg) throw E('EIO', msg); });
handle('host:quit', () => app.quit());

/* ---- terminal ---- */
handle('pty:spawn', async (e, o = {}) => {
  let cwd; if (o.cwd) { try { const h = fsb.toHost(o.cwd); if ((await fsp.stat(h)).isDirectory()) cwd = h; } catch {} }
  const send = (ch, ...a) => { if (!e.sender.isDestroyed()) e.sender.send(ch, ...a); };
  const info = pty.create({ cols: o.cols, rows: o.rows, cwd }, (id, d) => send('pty:data', id, d), (id, code) => send('pty:exit', id, code));
  return { ...info, cwd: fsb.toPub(cwd || os.homedir()) };
});
handle('pty:write', (e, id, d) => pty.write(id, String(d)));
handle('pty:resize', (e, id, c, r) => pty.resize(id, c, r));
handle('pty:kill', (e, id) => pty.kill(id));

/* ---- built-in web browser: real Chromium views (WebContentsView), so no iframe / X-Frame-Options / CORS limits ---- */
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

/* ---- window and app protocol ---- */
function createWindow() {
  const icon = path.join(ROOT, 'branding', 'neoicon.png');
  win = new BrowserWindow({ fullscreen: true, show: false, backgroundColor: '#0b0f16', autoHideMenuBar: true, title: 'neoOS', ...(fs.existsSync(icon) ? { icon } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false } });
  win.once('ready-to-show', () => win.show());
  win.loadURL(ORIGIN + 'index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, legacy) => { if (!String(e.url || legacy || '').startsWith(ORIGIN)) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); } });
  win.on('closed', () => { dropAllViews(); win = null; pty.killAll(); });
}
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('neoos', async req => {
      const u = new URL(req.url); let rel = decodeURIComponent(u.pathname); if (rel === '/' || !rel) rel = '/index.html';
      const parts = rel.split('/').filter(Boolean), file = path.normalize(path.join(ROOT, rel));
      if (u.host !== 'app' || !file.startsWith(ROOT + path.sep) || parts.some(s => s.startsWith('.') || s === 'node_modules' || s === 'electron' || s === 'dist') || /^package(-lock)?\.json$/.test(parts.join('/'))) return new Response('Not found', { status: 404 });
      try { return new Response(await fsp.readFile(file), { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } }); }
      catch { return new Response('Not found', { status: 404 }); }
    });
    const allow = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allow.has(perm)));
    session.defaultSession.setPermissionCheckHandler((wc, perm) => allow.has(perm));
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => pty.killAll());
}
