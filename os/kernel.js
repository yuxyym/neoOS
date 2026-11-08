// Kernel: app registry (built by scanning /applications), process table, syscall table, permission checks, bridge.
// Every app's `main` runs in its own Node.js subprocess (Electron utility process, see electron/procs.js + electron/proc-host.js).
// The kernel (this file, in the renderer) keeps the syscall table and relays messages to and from those subprocesses.
import * as wm from './wm.js';
import * as vfs from './vfs.js';
import * as host from './host.js';
import { openFilePicker } from './file-picker.js';
import { alert as showAlert, confirm as showConfirm, choose as showChoose } from './dialogs.js';
import * as accounts from './accounts.js';
export const API_VERSION = '1.0';
export class NeoError extends Error { constructor(code, message) { super(message); this.code = code; } }
export const THEMES = ['metro']; // single built-in look; not user-selectable
const subs = {};
export const bus = { on: (e, f) => (subs[e] ??= []).push(f), emit: (e, p) => (subs[e] || []).forEach(f => f(p)) };
export const journal = [];
export function log(level, src, msg) { journal.push({ t: Date.now(), level, src, msg }); if (journal.length > 500) journal.shift(); }

export const registry = new Map(), procs = new Map();
let nextPid = 1, shim, css;
export let currentUser = null;
let theme = 'metro';
const t = u => fetch(u).then(r => { if (!r.ok) throw new NeoError('ENOENT', 'Cannot load ' + u); return r.text(); });
const esc = s => s.replace(/<\/script/gi, '<\\/script');
async function inlineAppAssets(base, html) {
  // Opaque-origin window frames cannot safely resolve package-relative files. The
  // kernel loads trusted package assets and embeds them before the frame starts.
  const replace = async (tag, attr, type) => {
    const re = new RegExp(`<${tag}\\b([^>]*?)\\b${attr}=["']([^"']+)["']([^>]*)>`, 'gi');
    const matches = [...html.matchAll(re)];
    for (const match of matches) {
      const path = match[2];
      // Reject absolute URLs (any scheme), root/UNC paths and any `..` segment.
      if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(path) || path.split(/[\\/]/).includes('..')) throw new NeoError('EINVAL', 'App assets must use package-relative paths');
      const source = await t(base + path);
      const replacement = type === 'script' ? `<script>${esc(source)}</script>` : `<style>${source.replace(/<\/style/gi, '<\\/style')}</style>`;
      html = html.replace(match[0], () => replacement);
    }
  };
  await replace('script', 'src', 'script');
  await replace('link', 'href', 'style');
  return html;
}
const manifestFields = new Set(['id', 'name', 'version', 'description', 'icon', 'main', 'minApiVersion', 'categories', 'permissions', 'network', 'instance', 'autostart', 'associations', 'intents', 'contributes', 'exitWhenLastWindowCloses']);
function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new NeoError('EINVAL', 'Manifest must be an object');
  const unknown = Object.keys(m).filter(k => !manifestFields.has(k));
  if (unknown.length) throw new NeoError('EINVAL', `Unsupported manifest field(s): ${unknown.join(', ')}`);
  for (const k of ['id', 'name', 'version', 'description', 'icon', 'main', 'minApiVersion'])
    if (typeof m[k] !== 'string' || !m[k].trim()) throw new NeoError('EINVAL', `Manifest requires string field: ${k}`);
  if (m.main.startsWith('/') || m.main.split(/[\\/]/).includes('..')) throw new NeoError('EINVAL', 'main must be a package-relative path');
  if (m.instance != null && !['single', 'multi'].includes(m.instance)) throw new NeoError('EINVAL', 'instance must be single or multi');
  for (const k of ['categories', 'permissions', 'network', 'associations', 'intents'])
    if (m[k] != null && !Array.isArray(m[k])) throw new NeoError('EINVAL', `${k} must be an array`);
  if (m.contributes != null && (typeof m.contributes !== 'object' || Array.isArray(m.contributes))) throw new NeoError('EINVAL', 'contributes must be an object');
  // Missing means the default policy: stop the process when its last window closes.
  return { ...m, exitWhenLastWindowCloses: m.exitWhenLastWindowCloses !== false };
}

// App discovery: every folder in /applications with a manifest.json is an app. New folders are picked up by later scans; nothing is ever removed mid-session.
const badDirs = new Set();
export async function scanApps() {
  let added = 0;
  for (const found of await host.call('host:apps')) {
    if (found.error) { if (!badDirs.has(found.dir)) { badDirs.add(found.dir); log('error', 'init', `bad app ${found.dir}: ${found.error}`); } continue; }
    try {
      const manifest = validateManifest(found.manifest);
      if (registry.has(manifest.id)) continue;
      registry.set(manifest.id, { manifest, base: `applications/${found.dir}/`, dir: found.dir }); added++; badDirs.delete(found.dir);
    } catch (e) { if (!badDirs.has(found.dir)) { badDirs.add(found.dir); log('error', 'init', `bad app ${found.dir}: ${e.message}`); } }
  }
  return added;
}

// Terminal sessions: pty id -> owning pid. Output that arrives before the owner is registered is held briefly.
const ptyOwner = new Map(), ptyBacklog = new Map();

export async function init() {
  await vfs.init();
  document.documentElement.dataset.theme = theme; wm.setTheme(theme);
  const [a, c, r] = await Promise.all([t('sdk/neo-frame.js'), t('neoui/neoui.css'), t('neoui/retro.css')]);
  [shim, css] = [a, c + '\n' + r];
  await scanApps();
  host.on('pty:data', (id, data) => {
    const p = procs.get(ptyOwner.get(id));
    if (p) send(p, 'pty:data', { id, data }); else (ptyBacklog.get(id) || ptyBacklog.set(id, []).get(id)).push(data);
  });
  host.on('pty:exit', (id, code) => { const p = procs.get(ptyOwner.get(id)); ptyOwner.delete(id); ptyBacklog.delete(id); p && send(p, 'pty:exit', { id, code }); });
  host.on('browser:state', (id, st) => { const v = bviews.get(id), p = v && procs.get(v.pid); p && send(p, 'browser:state', { id, ...st }); });
  host.on('browser:focus', id => { const v = bviews.get(id); v && wm.focus(v.w); });
  host.on('proc:msg', (pid, m) => { const p = procs.get(pid); p && handle(p, m); });
  host.on('proc:exit', (pid, code) => { const p = procs.get(pid); if (!p) return; log(code ? 'warn' : 'info', p.appId, `process ${pid} exited (${code})`); kill(pid); });
  wm.hooks.onClose = w => { dropWindowViews(w.id); const p = procs.get(w.pid); if (!p) return; p.windows.delete(w.id); send(p, 'window:close', { wid: w.id });
    if (!p.windows.size && p.manifest.exitWhenLastWindowCloses !== false) setTimeout(() => kill(p.pid), 30); };
  wm.hooks.onMessage = (w, data) => { const p = procs.get(w.pid); p && send(p, 'window:message', { wid: w.id, data }); };
  wm.hooks.onRemoteReady = w => { const p = procs.get(w.pid); p && send(p, 'window:remote-ready', { wid: w.id }); };
  wm.hooks.onRemoteError = w => { const p = procs.get(w.pid); p && send(p, 'window:remote-error', { wid: w.id }); };
  wm.hooks.onAction = (w, action) => { const p = procs.get(w.pid); p && send(p, 'window:action', { wid: w.id, action }); };
  window.addEventListener('message', e => {
    const w = wm.list().find(candidate => candidate.remoteOrigin === e.origin && candidate.frame.contentWindow === e.source);
    if (!w) return;
    const p = procs.get(w.pid); p && send(p, 'window:remote-message', { wid: w.id, data: e.data });
  });
  wm.hooks.onBeforeClose = w => { const p = procs.get(w.pid); p && send(p, 'window:beforeclose', { wid: w.id }); };
  log('info', 'init', `${registry.size} apps found in /applications`);
}

export async function setCurrentUser(user) {
  currentUser = user;
  if (user) {
    setTheme('metro', user);
    const saved = localStorage.getItem(`neoos.wallpaper.${user.id}`) || 'default';
    try { await applyWallpaper(saved); } catch { await applyWallpaper('default'); }
  }
}
export function endSession() {
  [...procs.keys()].forEach(kill);
  currentUser = null;
  const desktop = document.getElementById('desktop'); if (desktop) desktop.style.removeProperty('background-image');
}
export async function lockSession() {
  const previous = currentUser;
  const next = await accounts.authenticate();
  if (previous && next.id !== previous.id) endSession();
  await setCurrentUser(next);
  return next;
}
// Wallpapers: "default", "preset:<name>" or the path of an image file on this computer.
let wallpaperUrl = null;
async function loadWallpaper(value) {
  if (value.startsWith('preset:')) { const svg = vfs.presets[value.slice(7)]; if (!svg) throw new NeoError('ENOENT', 'Unknown wallpaper'); return { mime: 'image/svg+xml', content: svg }; }
  return vfs.read(value);
}
async function applyWallpaper(value) {
  const desktop = document.getElementById('desktop'); if (!desktop) return;
  if (value === 'default') { desktop.style.removeProperty('background-image'); return; }
  const file = await loadWallpaper(value);
  const url = file.bytes && /^image\/(?:png|jpeg|webp|gif|avif|bmp)$/.test(file.mime) ? URL.createObjectURL(new Blob([file.bytes], { type: file.mime })) : wallpaperData(file, value);
  if (!url) throw new NeoError('EINVAL', 'Choose a supported image file');
  if (wallpaperUrl?.startsWith('blob:')) URL.revokeObjectURL(wallpaperUrl);
  wallpaperUrl = url; desktop.style.backgroundImage = `url("${url}")`;
}
function wallpaperData(file, path) { // returns a data: URL (also used for previews shown inside sandboxed windows)
  if (file.mime === 'image/svg+xml' || path.toLowerCase().endsWith('.svg')) {
    const content = file.content ?? new TextDecoder().decode(file.bytes || new Uint8Array());
    if (/<script|on[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(content)) return null;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
  }
  if (file.bytes && /^image\/(?:png|jpeg|webp|gif|avif|bmp)$/.test(file.mime)) {
    let binary = ''; const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${file.mime};base64,${btoa(binary)}`;
  }
  return null;
}

// Messages to an app subprocess go over the fire-and-forget host channel.
const post = (p, msg) => host.post('proc:send', p.pid, msg);
export const send = (p, event, payload) => post(p, { event, payload });

export async function launch(ref, args = {}) {
  if (!currentUser) throw new NeoError('EACCES', 'Sign in before launching apps');
  const key = String(ref).toLowerCase();
  const app = registry.get(ref) || [...registry.values()].find(a => a.manifest.name.toLowerCase() === key);
  if (!app) throw new NeoError('ENOENT', 'No such app: ' + ref);
  const m = app.manifest;
  if (m.instance === 'single') {
    const p = [...procs.values()].find(p => p.appId === m.id);
    if (p) { send(p, 'activate', args); const w = wm.list().find(w => w.pid === p.pid); w && wm.focus(w); return p.pid; }
  }
  const proc = { pid: nextPid++, appId: m.id, manifest: m, base: app.base, user: currentUser, windows: new Set(), started: Date.now(), tokens: 200, last: Date.now() };
  procs.set(proc.pid, proc);
  try { await host.call('proc:spawn', { pid: proc.pid, dir: app.dir, main: m.main }); }
  catch (e) { procs.delete(proc.pid); throw e; }
  post(proc, { neo: 'hello', pid: proc.pid, manifest: m, theme });
  send(proc, 'launch', args);
  log('info', 'kernel', `spawn pid ${proc.pid} ${m.id}`); bus.emit('process:start', proc.pid);
  return proc.pid;
}
export function kill(pid) {
  const p = procs.get(pid); if (!p) return false;
  procs.delete(pid);
  dropViewsOf(pid);
  for (const [id, owner] of ptyOwner) if (owner === pid) { ptyOwner.delete(id); host.call('pty:kill', id).catch(() => {}); }
  [...p.windows].forEach(id => { const w = wm.get(id); w && wm.close(w, true); });
  host.post('proc:kill', pid);
  log('info', 'kernel', `exit pid ${pid}`); bus.emit('process:exit', pid); wm.hooks.onChange?.(); return true;
}

// Scope check: manifest lists what the app MAY use; a trailing * is a prefix wildcard.
const allowed = (decl, need) => decl.some(d => d === need || (d.endsWith('*') && need.startsWith(d.slice(0, -1))));
const own = (p, wid) => { const w = wm.get(wid); if (!w) throw new NeoError('ENOENT', 'No such window'); if (w.pid !== p.pid) throw new NeoError('EPERM', 'Window belongs to another process'); return w; };
const ownPty = (p, id) => { if (ptyOwner.get(id) !== p.pid) throw new NeoError('EPERM', 'No such terminal session'); return id; };
const setTheme = (n, user = currentUser) => { if (!THEMES.includes(n)) return; theme = n; document.documentElement.dataset.theme = n; wm.setTheme(n); setTimeout(() => window.dispatchEvent(new Event('resize')), 60); /* re-fit windows to the new skin's panel/dock sizes */ procs.forEach(p => send(p, 'theme:changed', n)); };
const storeKey = (p, k) => `neoos.appdata.${p.user.id}.${p.appId}.${String(k).slice(0, 100)}`;

// Native browser views (Electron WebContentsView) float above the DOM. The kernel keeps each one glued to the body of its
// owning window and hides it while it is covered by another window, a menu, the launcher or a dialog.
// Bounds are sent in window DIPs, so they are multiplied by the interface zoom (window.__neoZoom, set by os/desktop-extras.js).
const bviews = new Map(); let bframe = 0;
const zOf = w => parseFloat(w.el.style.zIndex) || 0;
const ownView = (p, id) => { const v = bviews.get(id); if (!v || v.pid !== p.pid) throw new NeoError('EPERM', 'No such browser view'); return id; };
function dropView(id) { if (bviews.delete(id)) host.call('browser:destroy', id).catch(() => {}); }
function dropViewsOf(pid) { [...bviews].forEach(([id, v]) => v.pid === pid && dropView(id)); }
function dropWindowViews(wid) { [...bviews].forEach(([id, v]) => v.w.id === wid && dropView(id)); }
const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
export function activeWindowIsEmbedded() { const w = wm.get(wm.activeId()); return !!w && (!!w.remoteOrigin || [...bviews.values()].some(v => v.w === w)); }
function syncViews() {
  const overlay = !!document.querySelector('.neo-launcher,.neo-ctx,.neo-lock,[role=alertdialog],[role=dialog]'), zoom = window.__neoZoom || 1;
  for (const [id, v] of bviews) {
    const w = v.w, r = w.el.querySelector('.neo-win__body').getBoundingClientRect(), inset = 4; // inset keeps the window resize handles usable
    const c = { x: r.left + inset, y: r.top + v.top, width: Math.max(0, r.width - 2 * inset), height: Math.max(0, r.height - v.top - inset) };
    const box = { left: c.x, top: c.y, right: c.x + c.width, bottom: c.y + c.height };
    let visible = !overlay && !w.min && !w.el.hidden && !w.el.classList.contains('is-closing') && !w.el.classList.contains('is-minimizing');
    if (visible) for (const o of wm.list()) if (o !== w && !o.min && !o.el.hidden && zOf(o) > zOf(w) && hit(box, o.el.getBoundingClientRect())) { visible = false; break; }
    const b = { x: Math.round(c.x * zoom), y: Math.round(c.y * zoom), width: Math.round(c.width * zoom), height: Math.round(c.height * zoom) };
    const key = [b.x, b.y, b.width, b.height, visible].join();
    if (key !== v.last) { v.last = key; host.call('browser:bounds', id, { ...b, visible }).catch(() => {}); }
  }
}
function pumpViews() {
  if (bframe) return;
  const tick = () => { if (!bviews.size) { bframe = 0; return; } try { syncViews(); } catch {} bframe = requestAnimationFrame(tick); };
  bframe = requestAnimationFrame(tick);
}

const S = {
  'system.getApiVersion': { fn: () => API_VERSION },
  'system.supports': { fn: (p, f) => typeof f === 'string' && f in S },
  'system.info': { fn: () => ({ name: 'neoOS', version: '1.0.0', api: API_VERSION, processes: procs.size }) },
  'system.storage': { fn: async () => { try { const d = await host.call('host:disk'); return { usage: d.total - d.free, quota: d.total }; } catch { return null; } } },
  'system.lock': { fn: () => { setTimeout(() => lockSession().catch(e => showAlert({ title: 'Unable to lock neoOS', message: e.message })), 0); } },
  'system.paths': { fn: () => host.call('host:paths') },
  'system.hostInfo': { scope: 'host.info', fn: () => host.call('host:info') },
  'system.hostStats': { scope: 'host.info', fn: () => host.call('host:stats') },
  'system.hostProcesses': { scope: 'host.processes', fn: () => host.call('host:processes') },
  'system.killHostProcess': { scope: 'host.kill', fn: (p, pid) => host.call('host:kill', Number(pid)) },
  'system.openPath': { scope: 'host.open', fn: (p, path) => host.call('host:open', requireFs(p, 'fs.read', path)) },
  'storage.get': { fn: (p, k) => localStorage.getItem(storeKey(p, k)) },
  'storage.set': { fn: (p, k, v) => { v = String(v); if (v.length > 1e6) throw new NeoError('EINVAL', 'Value too large'); localStorage.setItem(storeKey(p, k), v); } },
  'storage.remove': { fn: (p, k) => { localStorage.removeItem(storeKey(p, k)); } },
  'browser.open': { scope: 'browser', fn: async (p, o = {}) => {
    const w = own(p, o.wid), id = await host.call('browser:create', { url: o.url ? String(o.url) : undefined });
    bviews.set(id, { pid: p.pid, w, top: Math.max(0, Number(o.top) || 0), last: '' }); pumpViews(); return id;
  } },
  'browser.navigate': { scope: 'browser', fn: (p, id, url) => host.call('browser:navigate', ownView(p, id), String(url)) },
  'browser.action': { scope: 'browser', fn: (p, id, a) => host.call('browser:action', ownView(p, id), String(a)) },
  'browser.close': { scope: 'browser', fn: (p, id) => { dropView(ownView(p, id)); } },
  'pty.spawn': { scope: 'pty', fn: async (p, o = {}) => {
    const r = await host.call('pty:spawn', { cols: Number(o.cols) || 80, rows: Number(o.rows) || 24, cwd: o.cwd ? vfs.normalize(o.cwd) : undefined });
    ptyOwner.set(r.id, p.pid);
    for (const d of ptyBacklog.get(r.id) || []) send(p, 'pty:data', { id: r.id, data: d });
    ptyBacklog.delete(r.id); return r;
  } },
  'pty.write': { scope: 'pty', fn: (p, id, data) => host.call('pty:write', ownPty(p, id), String(data)) },
  'pty.resize': { scope: 'pty', fn: (p, id, c, r) => host.call('pty:resize', ownPty(p, id), Number(c), Number(r)) },
  'pty.kill': { scope: 'pty', fn: (p, id) => host.call('pty:kill', ownPty(p, id)) },
  'account.self': { fn: p => ({ id: p.user.id, username: p.user.username, displayName: p.user.displayName, role: p.user.role }) },
  'account.list': { scope: 'account.manage', fn: p => { if (p.user.role !== 'admin') throw new NeoError('EPERM', 'Only an administrator can manage accounts'); return accounts.listAccounts(); } },
  'account.create': { scope: 'account.manage', fn: async (p, data) => { if (p.user.role !== 'admin') throw new NeoError('EPERM', 'Only an administrator can manage accounts'); return accounts.createAccount(data); } },
  'desktop.getWallpaper': { fn: p => localStorage.getItem(`neoos.wallpaper.${p.user.id}`) || 'default' },
  'desktop.listWallpapers': { scope: 'desktop.customize', fn: async () => {
    const images = [];
    try {
      const pictures = (await host.call('host:paths')).pictures;
      for (const e of await vfs.list(pictures)) {
        if (images.length >= 24) break;
        if (e.type !== 'file' || !e.mime?.startsWith('image/')) continue;
        let preview; if (e.size < 1.5e6) { try { preview = wallpaperData(await vfs.read(e.path), e.path); } catch {} }
        images.push({ id: e.path, label: e.name, kind: 'file', ...(preview ? { preview } : {}) });
      }
    } catch {}
    const presets = Object.keys(vfs.presets).map(n => ({ id: `preset:${n}`, label: n[0].toUpperCase() + n.slice(1), kind: 'preset', preview: wallpaperData({ mime: 'image/svg+xml', content: vfs.presets[n] }, n + '.svg') }));
    return [{ id: 'default', label: 'neoOS default', kind: 'preset' }, ...presets, ...images];
  } },
  'desktop.setWallpaper': { scope: 'desktop.customize', fn: async (p, value) => {
    const selected = String(value); await applyWallpaper(selected); localStorage.setItem(`neoos.wallpaper.${p.user.id}`, selected);
  } },
  'app.exit': { fn: p => { setTimeout(() => kill(p.pid), 0); } },
  'app.getManifest': { fn: p => p.manifest },
  'app.readAsset': { fn: async (p, path) => { const f = String(path || ''); if (!f || f.startsWith('/') || f.split(/[\\/]/).includes('..')) throw new NeoError('EINVAL', 'App asset path must be package-relative'); const response = await fetch(p.base + f); if (!response.ok) throw new NeoError('ENOENT', 'App asset not found'); return new Uint8Array(await response.arrayBuffer()); } },
  'app.list': { fn: () => [...registry.values()].map(a => a.manifest) },
  'app.rescan': { fn: () => scanApps() },
  'app.launch': { scope: 'app.launch', fn: (p, ref, args) => launch(ref, args) },
  'process.self': { fn: p => ({ pid: p.pid, appId: p.appId }) },
  'process.list': { scope: 'process.list', fn: () => [...procs.values()].map(p => ({ pid: p.pid, appId: p.appId, name: p.manifest.name, windows: p.windows.size, started: p.started, state: 'running' })) },
  'process.focus': { scope: 'process.focus', fn: (p, pid) => { const w = wm.list().filter(w => w.pid === +pid).at(-1); if (!w) return false; wm.focus(w); return true; } },
  'process.minimize': { scope: 'process.minimize', fn: (p, pid) => { const ws = wm.list().filter(w => w.pid === +pid); if (!ws.length) return false; ws.forEach(wm.minimize); return true; } },
  'process.kill': { scope: 'process.kill', fn: (p, pid) => kill(+pid) },
  'theme.get': { fn: () => theme },
  'theme.set': { scope: 'theme.set', fn: (p, n) => setTheme(n, p.user) },
  'log.write': { fn: (p, lv, msg) => log(['debug', 'info', 'warn', 'error'].includes(lv) ? lv : 'info', p.appId, String(msg).slice(0, 500)) },
  'log.read': { scope: 'log.read', fn: (p, limit = 100) => journal.slice(-Math.max(1, Math.min(500, Number(limit) || 100))).map(e => ({ ...e })) },
  'dialog.alert': { fn: (p, options = {}) => showAlert(options) },
  'dialog.confirm': { fn: (p, options = {}) => showConfirm(options) },
  'dialog.choose': { fn: (p, options = {}) => showChoose(options) },
  'fs.list': { fn: (p, path = '/') => vfs.list(requireFs(p, 'fs.read', path)) },
  'fs.read': { fn: (p, path) => vfs.read(requireFs(p, 'fs.read', path)) },
  'fs.write': { fn: (p, path, data, mime) => vfs.write(requireFs(p, 'fs.write', path), data, mime) },
  'fs.mkdir': { fn: (p, path) => vfs.mkdir(requireFs(p, 'fs.write', path)) },
  'fs.remove': { fn: (p, path, opts) => vfs.remove(requireFs(p, 'fs.write', path), { permanent: !!opts?.permanent }) },
  'fs.move': { fn: (p, from, to) => vfs.move(requireFs(p, 'fs.write', from), requireFs(p, 'fs.write', to)) },
  'fs.copy': { fn: (p, from, to) => vfs.copy(requireFs(p, 'fs.read', from), requireFs(p, 'fs.write', to)) },
  'dialog.openFile': { fn: async (p, options = {}) => { const home = (await host.call('host:paths')).home; return openFilePicker({ ...options, startPath: options.startPath ? vfs.normalize(options.startPath) : home, homePath: home }); } },
  'window.create': { fn: async (p, o = {}) => {
    const c = o.content || {}; let html = c.html, remoteUrl;
    if (c.url != null) {
      const parsed = new URL(String(c.url), location.href);
      if (parsed.protocol !== 'https:' || !(p.manifest.network || []).includes(parsed.origin)) throw new NeoError('EACCES', 'This app is not allowed to open that network origin');
      if (parsed.origin === location.origin) throw new NeoError('EACCES', 'A remote editor must use an isolated origin');
      parsed.searchParams.set('embed', '1'); parsed.searchParams.set('embedOrigin', location.origin); remoteUrl = parsed.href;
    }
    if (c.file != null) { const f = String(c.file); if (f.includes('..') || f.startsWith('/')) throw new NeoError('EINVAL', 'Bad path'); html = await t(p.base + f); }
    if (!remoteUrl) {
      if (typeof html !== 'string') throw new NeoError('EINVAL', 'content.html, content.file, or an allowed content.url is required');
      html = await inlineAppAssets(p.base, html);
    }
    // The theme is baked into the document so light-theme windows never flash dark before the kernel's hello arrives.
    const doc = remoteUrl ? null : `<!doctype html><html data-theme="${theme}"><meta charset=utf-8><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark light"><style>${css}</style><script>${esc(shim)}<\/script>${html}`;
    const w = wm.create(p, { ...o, remoteUrl }, doc); p.windows.add(w.id); return w.id; } },
  'window.setTitle': { fn: (p, id, v) => wm.setTitle(own(p, id), v) },
  'window.resize': { fn: (p, id, a, b) => wm.resize(own(p, id), +a, +b) },
  'window.move': { fn: (p, id, x, y) => wm.move(own(p, id), +x, +y) },
  'window.focus': { fn: (p, id) => wm.focus(own(p, id)) },
  'window.minimize': { fn: (p, id) => wm.minimize(own(p, id)) },
  'window.maximize': { fn: (p, id) => wm.maximize(own(p, id)) },
  'window.setAlwaysOnTop': { fn: (p, id, v) => wm.setTop(own(p, id), v) },
  'window.setBeforeClose': { fn: (p, id, v) => { own(p, id).guard = !!v; } },
  'window.close': { fn: (p, id) => wm.close(own(p, id)) },
  'window.postMessage': { fn: (p, id, d) => { const w = own(p, id); if (w.remoteOrigin) w.frame.contentWindow.postMessage(d, w.remoteOrigin); else w.port.postMessage(d); } },
};
// Manifest scope `fs.read:~/*` / `fs.write:~/*` covers the whole host file system; narrower scopes such as `fs.read:~/home/me/Documents/*` also work.
function requireFs(proc, op, path) {
  const normalized = vfs.normalize(path), need = `${op}:~${normalized}`;
  if (!allowed(proc.manifest.permissions || [], need)) throw new NeoError('EACCES', `Missing permission: ${need}`);
  return normalized;
}
export const syscalls = S;

// Bridge: validate shape, rate-limit (200-call burst, refilled at 200 calls/s), check scope, dispatch, log.
async function handle(proc, m) {
  if (!m || typeof m.id !== 'number' || typeof m.api !== 'string' || typeof m.method !== 'string' || !Array.isArray(m.args)) return;
  const key = `${m.api}.${m.method}`, now = Date.now(), t0 = performance.now(); let res;
  proc.tokens = Math.min(200, proc.tokens + (now - proc.last) / 5); proc.last = now;
  try {
    if (--proc.tokens < 0) throw new NeoError('ERATE', 'Rate limit exceeded');
    const sc = S[key]; if (!sc) throw new NeoError('ENOSYS', `Unknown call ${key}`);
    if (sc.scope && !allowed(proc.manifest.permissions || [], sc.scope)) throw new NeoError('EACCES', `Missing permission: ${sc.scope}`);
    res = { id: m.id, ok: true, result: await sc.fn(proc, ...m.args) };
  } catch (e) {
    res = { id: m.id, ok: false, error: { code: e.code || 'EINVAL', message: e.message } };
    log('warn', proc.appId, `${key} -> ${res.error.code}`);
  }
  log('debug', proc.appId, `${key} ${(performance.now() - t0).toFixed(1)}ms`);
  if (procs.has(proc.pid)) post(proc, res);
}
