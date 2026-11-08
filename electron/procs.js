'use strict';
// App discovery + app subprocesses.
//  * host:apps   - every folder in /applications that contains a manifest.json is an app (no index file).
//  * proc:spawn  - runs an app's `main` in its own Electron utility process (a real Node.js process with full Node API access).
//  * proc:send / proc:kill / proc:msg / proc:exit - message relay between the kernel (renderer) and each app process.
const { app, ipcMain, utilityProcess } = require('electron');
const path = require('node:path'), fs = require('node:fs');
const ROOT = path.join(__dirname, '..'), APPS = path.join(ROOT, 'applications'), HOST = path.join(__dirname, 'proc-host.js'), ORIGIN = 'neoos://app/';
const SAFE = /^[\w][\w.-]*$/;
const trusted = e => !!e.senderFrame && e.senderFrame.url.startsWith(ORIGIN);
const E = (code, message) => Object.assign(new Error(message), { code });
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...a) => {
    if (!trusted(e)) return { ok: false, error: { code: 'EACCES', message: 'Untrusted sender' } };
    try { return { ok: true, result: await fn(e, ...a) }; } catch (err) { return { ok: false, error: { code: err.code || 'EIO', message: err.message } }; }
  });
}

handle('host:apps', () => {
  const out = [];
  for (const d of fs.readdirSync(APPS, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || !SAFE.test(d.name)) continue;
    try { out.push({ dir: d.name, manifest: JSON.parse(fs.readFileSync(path.join(APPS, d.name, 'manifest.json'), 'utf8')) }); }
    catch (err) { if (err.code !== 'ENOENT') out.push({ dir: d.name, error: err.message }); }
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
});

const children = new Map(), watched = new WeakSet(); // pid -> { child, sender }
const killChild = pid => { const c = children.get(pid); if (c) { children.delete(pid); try { c.child.kill(); } catch {} } };
const killOwned = sender => { for (const [pid, c] of [...children]) if (c.sender === sender) killChild(pid); };

handle('proc:spawn', (e, o = {}) => {
  const pid = Number(o.pid), dir = String(o.dir || ''), main = String(o.main || '');
  if (!Number.isInteger(pid) || pid < 1 || children.has(pid)) throw E('EINVAL', 'Bad process id');
  if (!SAFE.test(dir)) throw E('EINVAL', 'Bad app folder');
  const base = path.join(APPS, dir), entry = path.resolve(base, main);
  if (!entry.startsWith(base + path.sep) || !fs.existsSync(entry)) throw E('ENOENT', `App entry not found: ${dir}/${main}`);
  const sender = e.sender;
  const child = utilityProcess.fork(HOST, [], { serviceName: 'neoOS ' + dir, cwd: base, env: { ...process.env, NEOOS_PID: String(pid), NEOOS_ENTRY: entry, NEOOS_APP_DIR: base } });
  children.set(pid, { child, sender });
  if (!watched.has(sender)) { watched.add(sender); sender.once('destroyed', () => killOwned(sender)); }
  child.on('message', data => { if (!sender.isDestroyed()) sender.send('proc:msg', pid, data); });
  child.on('exit', code => {
    if (children.get(pid)?.child === child) children.delete(pid);
    if (!sender.isDestroyed()) sender.send('proc:exit', pid, code);
  });
  return true;
});
ipcMain.on('proc:send', (e, pid, msg) => { if (!trusted(e)) return; const c = children.get(Number(pid)); if (c && c.sender === e.sender) { try { c.child.postMessage(msg); } catch {} } });
ipcMain.on('proc:kill', (e, pid) => { if (!trusted(e)) return; const c = children.get(Number(pid)); if (c && c.sender === e.sender) killChild(Number(pid)); });
handle('ui:zoom', (e, f) => { f = Math.min(2, Math.max(.5, Number(f) || 1)); e.sender.setZoomFactor(f); return f; });
app.on('will-quit', () => [...children.keys()].forEach(killChild));
