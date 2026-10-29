// Kernel: app registry, process table, syscall table, permission checks, bridge.
// Each app's `main` runs in a hidden sandboxed iframe (opaque origin). The kernel loads all files itself.
import * as wm from './wm.js';
import * as vfs from './vfs.js';
import { openFilePicker } from './file-picker.js';
import { alert as showAlert, confirm as showConfirm, choose as showChoose } from './dialogs.js';
import * as accounts from './accounts.js';
export const API_VERSION = '1.0';
export class NeoError extends Error { constructor(code, message) { super(message); this.code = code; } }
const subs = {};
export const bus = { on: (e, f) => (subs[e] ??= []).push(f), emit: (e, p) => (subs[e] || []).forEach(f => f(p)) };
export const journal = [];
export function log(level, src, msg) { journal.push({ t: Date.now(), level, src, msg }); if (journal.length > 500) journal.shift(); }

export const registry = new Map(), procs = new Map();
let nextPid = 1, sdk, shim, css;
export let currentUser = null;
let theme = (() => { try { return localStorage.getItem('neoos.theme') || 'dark'; } catch { return 'dark'; } })();
const t = u => fetch(u).then(r => { if (!r.ok) throw new NeoError('ENOENT', 'Cannot load ' + u); return r.text(); });
const esc = s => s.replace(/<\/script/gi, '<\\/script');
async function inlineAppAssets(base, html) {
  // Opaque-origin app frames cannot safely resolve package-relative files. The
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

export async function init() {
  await vfs.init();
  document.documentElement.dataset.theme = theme; wm.setTheme(theme);
  const [idx, a, b, c] = await Promise.all([t('os/apps.index.json').then(JSON.parse), t('sdk/neo-sdk.js'), t('sdk/neo-frame.js'), t('neoui/neoui.css')]);
  [sdk, shim, css] = [a, b, c];
  for (const dir of idx) {
    try { const base = `applications/${dir}/`; const manifest = validateManifest(JSON.parse(await t(base + 'manifest.json'))); registry.set(manifest.id, { manifest, base }); }
    catch (e) { log('error', 'init', `bad app ${dir}: ${e.message}`); }
  }
  for (const dir of idx) {
    const app = [...registry.values()].find(a => a.base === `applications/${dir}/`); if (!app) continue;
    const files = [['manifest.json', JSON.stringify(app.manifest, null, 2)]];
    for (const file of [app.manifest.main, app.manifest.icon, 'view.html']) {
      if (files.some(entry => entry[0] === file)) continue;
      try { files.push([file, await t(app.base + file), file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.html') ? 'text/html' : 'text/javascript']); } catch {}
    }
    await vfs.seedPackage(dir, files);
  }
  wm.hooks.onClose = w => { const p = procs.get(w.pid); if (!p) return; p.windows.delete(w.id); send(p, 'window:close', { wid: w.id });
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
  log('info', 'init', `${registry.size} apps registered`);
}

export async function setCurrentUser(user) {
  currentUser = user;
  if (user) {
    await vfs.ensureHome(user.id, user.username);
    const savedTheme = localStorage.getItem(`neoos.theme.${user.id}`) || localStorage.getItem('neoos.theme') || 'dark';
    setTheme(['dark', 'light'].includes(savedTheme) ? savedTheme : 'dark', user);
    const saved = localStorage.getItem(`neoos.wallpaper.${user.id}`) || 'default';
    try { await applyWallpaper(wallpaperPhysicalPath(user, saved), user); } catch { await applyWallpaper('default', user); }
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
async function applyWallpaper(value, user = currentUser) {
  const desktop = document.getElementById('desktop'); if (!desktop || value === 'default') { desktop?.style.removeProperty('background-image'); return; }
  const known = ['/system/wallpapers/ocean.svg', '/system/wallpapers/forest.svg', '/system/wallpapers/dusk.svg'];
  const ownHome = user && `/home/${user.id}`;
  if (!known.includes(value) && !(ownHome && value.startsWith(`${ownHome}/`))) throw new NeoError('EACCES', 'Wallpaper must be a built-in or a file in your own Home folder');
  const file = await vfs.read(value), url = wallpaperData(file, value);
  if (!url) throw new NeoError('EINVAL', 'Choose a supported image in neoOS storage');
  desktop.style.backgroundImage = `url("${url}")`;
}
function wallpaperPhysicalPath(user, value) {
  if (['/system/wallpapers/ocean.svg', '/system/wallpapers/forest.svg', '/system/wallpapers/dusk.svg'].includes(value)) return value;
  return physicalPath({ user }, value);
}
function wallpaperData(file, path) {
  const content = file.content ?? (file.bytes ? new TextDecoder().decode(file.bytes) : '');
  if (file.mime === 'image/svg+xml' || path.toLowerCase().endsWith('.svg') || /^\s*<svg\b/i.test(content)) {
    if (/<script|on[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(content)) return null;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
  }
  if (file.bytes && /^image\/(?:png|jpeg|webp|gif|avif)$/.test(file.mime)) {
    let binary = ''; const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${file.mime};base64,${btoa(binary)}`;
  }
  return /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[\w+/]+=*$/i.test(file.content) ? file.content : null;
}

export const send = (p, event, payload) => p.port.postMessage({ event, payload });

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
  const main = await t(app.base + m.main);
  const proc = { pid: nextPid++, appId: m.id, manifest: m, base: app.base, user: currentUser, windows: new Set(), started: Date.now(), tokens: 200, last: Date.now() };
  const f = proc.frame = document.createElement('iframe');
  f.sandbox = 'allow-scripts'; f.hidden = true; f.title = m.name;
  f.srcdoc = `<!doctype html><script>${esc(sdk)}<\/script><script>${esc(main)}<\/script>`;
  const ch = new MessageChannel(); proc.port = ch.port1;
  ch.port1.onmessage = e => handle(proc, e.data);
  f.onload = () => { f.contentWindow.postMessage({ neo: 'hello', pid: proc.pid, manifest: m, theme }, '*', [ch.port2]); send(proc, 'launch', args); };
  procs.set(proc.pid, proc); document.body.append(f);
  log('info', 'kernel', `spawn pid ${proc.pid} ${m.id}`); bus.emit('process:start', proc.pid);
  return proc.pid;
}
export function kill(pid) {
  const p = procs.get(pid); if (!p) return false;
  procs.delete(pid);
  [...p.windows].forEach(id => { const w = wm.get(id); w && wm.close(w, true); });
  p.frame.remove(); p.port.close();
  log('info', 'kernel', `exit pid ${pid}`); bus.emit('process:exit', pid); wm.hooks.onChange?.(); return true;
}

// Scope check: manifest lists what the app MAY use; a trailing * is a prefix wildcard.
const allowed = (decl, need) => decl.some(d => d === need || (d.endsWith('*') && need.startsWith(d.slice(0, -1))));
const own = (p, wid) => { const w = wm.get(wid); if (!w) throw new NeoError('ENOENT', 'No such window'); if (w.pid !== p.pid) throw new NeoError('EPERM', 'Window belongs to another process'); return w; };
const setTheme = (n, user = currentUser) => { if (!['dark', 'light'].includes(n)) throw new NeoError('EINVAL', 'Unknown theme'); theme = n; try { localStorage.setItem('neoos.theme', n); if (user) localStorage.setItem(`neoos.theme.${user.id}`, n); } catch {} document.documentElement.dataset.theme = n; wm.setTheme(n); procs.forEach(p => send(p, 'theme:changed', n)); };

const S = {
  'system.getApiVersion': { fn: () => API_VERSION },
  'system.supports': { fn: (p, f) => typeof f === 'string' && f in S },
  'system.info': { fn: () => ({ name: 'neoOS', version: '1.0.0', api: API_VERSION, processes: procs.size }) },
  'system.storage': { fn: async () => { try { return await navigator.storage?.estimate?.() || null; } catch { return null; } } },
  'system.lock': { fn: () => { setTimeout(() => lockSession().catch(e => showAlert({ title: 'Unable to lock neoOS', message: e.message })), 0); } },
  'account.self': { fn: p => ({ id: p.user.id, username: p.user.username, displayName: p.user.displayName, role: p.user.role }) },
  'account.list': { scope: 'account.manage', fn: p => { if (p.user.role !== 'admin') throw new NeoError('EPERM', 'Only an administrator can manage accounts'); return accounts.listAccounts(); } },
  'account.create': { scope: 'account.manage', fn: async (p, data) => { if (p.user.role !== 'admin') throw new NeoError('EPERM', 'Only an administrator can manage accounts'); return accounts.createAccount(data); } },
  'desktop.getWallpaper': { fn: p => localStorage.getItem(`neoos.wallpaper.${p.user.id}`) || 'default' },
  'desktop.listWallpapers': { scope: 'desktop.customize', fn: async p => {
    const userHome = `/home/${p.user.id}`; let images = [], todo = [userHome], visited = 0;
    while (todo.length && visited < 500) {
      const entries = await vfs.list(todo.shift());
      for (const entry of entries) {
        if (entry.type === 'directory') { todo.push(entry.path); continue; }
        visited++;
        if (!entry.mime?.startsWith('image/')) continue;
        const file = await vfs.read(entry.path), preview = wallpaperData(file, entry.path);
        if (preview) images.push({ id: publicPath(p, entry.path), label: entry.name, kind: 'file', preview });
      }
    }
    const presets = await Promise.all(['ocean', 'forest', 'dusk'].map(async n => { const id = `/system/wallpapers/${n}.svg`; const file = await vfs.read(id); return { id, label: n[0].toUpperCase() + n.slice(1), kind: 'preset', preview: wallpaperData(file, id) }; }));
    return [{ id: 'default', label: 'neoOS default', kind: 'preset' }, ...presets, ...images];
  } },
  'desktop.setWallpaper': { scope: 'desktop.customize', fn: async (p, value) => {
    const selected = String(value); await applyWallpaper(wallpaperPhysicalPath(p.user, selected), p.user); localStorage.setItem(`neoos.wallpaper.${p.user.id}`, selected);
  } },
  'app.exit': { fn: p => { setTimeout(() => kill(p.pid), 0); } },
  'app.getManifest': { fn: p => p.manifest },
  'app.readAsset': { fn: async (p, path) => { const f = String(path || ''); if (!f || f.startsWith('/') || f.split(/[\\/]/).includes('..')) throw new NeoError('EINVAL', 'App asset path must be package-relative'); const response = await fetch(p.base + f); if (!response.ok) throw new NeoError('ENOENT', 'App asset not found'); return new Uint8Array(await response.arrayBuffer()); } },
  'app.list': { fn: () => [...registry.values()].map(a => a.manifest) },
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
  'fs.list': { fn: async (p, path = '/') => { const physical = requireFs(p, 'fs.read', path); return (await vfs.list(physical)).map(e => ({ ...e, path: publicPath(p, e.path) })); } },
  'fs.read': { fn: async (p, path) => { const file = await vfs.read(requireFs(p, 'fs.read', path)); return { ...file, path: publicPath(p, file.path) }; } },
  'fs.write': { fn: async (p, path, data, mime) => { const e = await vfs.write(requireFs(p, 'fs.write', path), data, mime); return { ...e, path: publicPath(p, e.path) }; } },
  'fs.mkdir': { fn: async (p, path) => { const e = await vfs.mkdir(requireFs(p, 'fs.write', path)); return { ...e, path: publicPath(p, e.path) }; } },
  'fs.remove': { fn: (p, path) => vfs.remove(requireFs(p, 'fs.write', path)) },
  'fs.move': { fn: async (p, from, to) => { const e = await vfs.move(requireFs(p, 'fs.write', from), requireFs(p, 'fs.write', to)); return { ...e, path: publicPath(p, e.path) }; } },
  'dialog.openFile': { fn: async (p, options = {}) => { const home = `/home/${p.user.id}`, start = options.startPath ? physicalPath(p, options.startPath) : `${home}/Pictures`; const result = await openFilePicker({ ...options, startPath: start, homePath: home }); return result ? publicPath(p, result) : null; } },
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
function requireFs(proc, op, path) {
  const normalized = vfs.normalize(path);
  const scopes = proc.manifest.permissions || [];
  if (normalized === '/' || !normalized.startsWith('/home/')) {
    const need = `${op}:~${normalized === '/' ? '/' : normalized}`;
    if (!allowed(scopes, need)) throw new NeoError('EACCES', `Missing permission: ${need}`);
    return physicalPath(proc, normalized);
  }
  throw new NeoError('ENOENT', 'Path not found');
}
function physicalPath(proc, path) { const p = vfs.normalize(path); return p === '/' ? `/home/${proc.user.id}` : `/home/${proc.user.id}${p}`; }
function publicPath(proc, path) { const home = `/home/${proc.user.id}`; return path === home ? '/' : path.startsWith(`${home}/`) ? path.slice(home.length) : '/'; }
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
  if (procs.has(proc.pid)) proc.port.postMessage(res);
}
