// OS extras layered on the kernel/shell without touching them: user preferences (prefs.* / power.* syscalls),
// display overlays, dock auto-hide, global shortcuts, power menu entries and the browser snapshot/tab support.
import * as wm from './wm.js';
import * as host from './host.js';
import { launch, kill, lockSession, syscalls, procs } from './kernel.js';
import { toast } from './notifications.js';
import { setSoundsEnabled, soundsEnabled } from './sound.js';

const DEFAULTS = { dockSize: 'medium', dockAutoHide: false, desktopIcons: true, clock24: false, clockSeconds: false, reduceMotion: false, brightness: 100, nightLight: 0, sounds: true, volume: 68 };
const DOCK = { small: [42, 30], medium: [50, 36], large: [62, 46] };
const RANGE = { brightness: [40, 100], nightLight: [0, 100], volume: [0, 100] };
let prefs = { ...DEFAULTS }, uid = 'default', hot, dim, warm;
const vol = () => { const v = parseFloat(localStorage.getItem('neoos.volume')); return Number.isFinite(v) ? v : prefs.volume; };
const current = () => ({ ...prefs, sounds: soundsEnabled(), volume: vol() });
function load() { try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(`neoos.prefs.${uid}`) || '{}') }; } catch { prefs = { ...DEFAULTS }; } prefs = current(); }
function apply() {
  let st = document.getElementById('neoos-prefs'); if (!st) { st = document.createElement('style'); st.id = 'neoos-prefs'; document.head.append(st); }
  const [s, i] = DOCK[prefs.dockSize] || DOCK.medium;
  st.textContent = `[data-theme=metro]{--neo-dock-reserve:${prefs.dockAutoHide ? 14 : s + 36}px}
[data-theme=metro] .neo-dock__app,[data-theme=metro] .neo-dock__grid{width:${s}px;height:${s}px}[data-theme=metro] .neo-dock__app img{width:${i}px;height:${i}px}
${prefs.desktopIcons ? '' : '.neo-icons{display:none}'}
${prefs.reduceMotion ? '*,::before,::after{animation-duration:.01ms!important;transition-duration:.01ms!important}' : ''}
body.dock-autohide .neo-dock{transition:transform .2s,opacity .2s}
body.dock-autohide:not(.dock-show) .neo-dock{transform:translate(-50%,calc(100% + 16px))!important;animation:none!important;opacity:0;pointer-events:none}`;
  document.body.classList.toggle('dock-autohide', prefs.dockAutoHide); if (hot) hot.style.display = prefs.dockAutoHide ? 'block' : 'none';
  dim.style.opacity = (100 - prefs.brightness) / 100 * .7; warm.style.opacity = prefs.nightLight / 100 * .6;
  setSoundsEnabled(prefs.sounds); try { localStorage.setItem('neoos.volume', String(prefs.volume)); } catch {}
  setTimeout(() => window.dispatchEvent(new Event('resize')), 30); // re-fit maximized windows to the new dock size
}
function setPrefs(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS) || typeof v !== typeof DEFAULTS[k]) continue;
    if (k === 'dockSize' && !DOCK[v]) continue;
    prefs[k] = RANGE[k] ? Math.min(RANGE[k][1], Math.max(RANGE[k][0], Math.round(v))) : v;
  }
  try { localStorage.setItem(`neoos.prefs.${uid}`, JSON.stringify(prefs)); } catch {}
  apply(); return current();
}
const restart = () => { [...procs.keys()].forEach(kill); setTimeout(() => location.reload(), 200); };
syscalls['prefs.get'] = { fn: () => current() };
syscalls['prefs.set'] = { scope: 'desktop.customize', fn: (p, patch) => setPrefs(patch) };
syscalls['power.restart'] = { scope: 'desktop.customize', fn: () => { restart(); } };
syscalls['power.shutdown'] = { scope: 'desktop.customize', fn: () => host.call('host:quit') };

/* ---- browser: tabs + snapshots. Native views are hidden when covered; a snapshot image takes their place. ---- */
const reg = new Map(), intended = new Map(), shown = new Map(), chains = new Map(), imgs = new Map(), off = new Set();
const sendRaw = (i, b) => host.callRaw('browser:bounds', i, b);
function imgFor(id) {
  const r = reg.get(id), w = r && wm.get(r.wid); if (!w) return null;
  let img = imgs.get(id);
  if (!img || !img.isConnected) {
    img = document.createElement('img'); img.alt = '';
    Object.assign(img.style, { position: 'absolute', left: '4px', top: r.top + 'px', width: 'calc(100% - 8px)', height: `calc(100% - ${r.top + 4}px)`, pointerEvents: 'none', zIndex: '2', display: 'none' });
    w.el.querySelector('.neo-win__body').append(img); imgs.set(id, img);
  }
  return img;
}
const queue = (id, fn) => { const p = (chains.get(id) || Promise.resolve()).then(fn, fn); chains.set(id, p.catch(() => {})); return p; };
async function applyBounds(id, send) {
  const b = intended.get(id); if (!b) return;
  const want = !!b.visible && !off.has(id), was = shown.get(id) || false, img = imgFor(id);
  if (want) { shown.set(id, true); if (img) img.style.display = 'none'; return send(id, { ...b, visible: true }); }
  if (img) {
    if (was && !off.has(id)) { try { const url = await host.callRaw('browser:snapshot', id); if (url) { img.src = url; img.style.display = 'block'; } } catch {} }
    else if (off.has(id)) img.style.display = 'none';
  }
  shown.set(id, false); return send(id, { ...b, visible: false });
}
host.hooks.bounds = (id, b, send) => { intended.set(id, b); return queue(id, () => applyBounds(id, send)); };
const open0 = syscalls['browser.open'], close0 = syscalls['browser.close'];
if (open0) syscalls['browser.open'] = { ...open0, fn: async (p, o = {}) => { const id = await open0.fn(p, o); reg.set(id, { pid: p.pid, wid: o.wid, top: Math.max(0, Number(o.top) || 0) }); return id; } };
if (close0) syscalls['browser.close'] = { ...close0, fn: (p, id) => { const r = close0.fn(p, id); [reg, intended, shown, chains].forEach(m => m.delete(id)); off.delete(id); imgs.get(id)?.remove(); imgs.delete(id); return r; } };
syscalls['browser.setActive'] = { scope: 'browser', fn: (p, id, on) => {
  const r = reg.get(id); if (!r || r.pid !== p.pid) throw Object.assign(new Error('No such browser view'), { code: 'EPERM' });
  on ? off.delete(id) : off.add(id); const img = imgFor(id); if (img) img.style.display = 'none';
  return queue(id, () => applyBounds(id, sendRaw));
} };

/* ---- shortcuts ---- */
const zOf = w => parseFloat(w.el.style.zIndex) || 0;
let hiddenWins = null;
function showDesktop() {
  if (hiddenWins) { hiddenWins.forEach(w => wm.get(w.id) && wm.focus(w)); hiddenWins = null; return; }
  const ws = wm.list().filter(w => !w.min); if (!ws.length) return; hiddenWins = ws; ws.forEach(wm.minimize);
}
function cycle(dir) {
  const ws = wm.list().filter(w => !w.min).sort((a, b) => zOf(a) - zOf(b)); if (ws.length < 2) return;
  wm.focus(dir > 0 ? ws[0] : ws[ws.length - 2]);
}
const open = id => launch(id).catch(() => {});

export function initExtras(user) {
  uid = user.id;
  dim = document.createElement('div'); warm = document.createElement('div');
  const scr = document.createElement('div'); scr.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60000';
  dim.style.cssText = 'position:absolute;inset:0;background:#000'; warm.style.cssText = 'position:absolute;inset:0;background:rgb(255,150,60);mix-blend-mode:multiply';
  scr.append(dim, warm); document.body.append(scr);
  hot = document.createElement('div'); hot.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:6px;z-index:19998;display:none'; document.body.append(hot);
  const dock = document.getElementById('dock'); let t;
  const show = () => { clearTimeout(t); document.body.classList.add('dock-show'); };
  const hide = () => { clearTimeout(t); t = setTimeout(() => document.body.classList.remove('dock-show'), 500); };
  hot.onpointerenter = show; dock.addEventListener('pointerenter', show); dock.addEventListener('pointerleave', hide);
  load(); apply();
  setInterval(() => {
    if (!prefs.clock24 && !prefs.clockSeconds) return;
    const b = document.querySelector('#panel .neo-panel__side:nth-child(2) .neo-panel__btn');
    if (b) b.textContent = new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: prefs.clockSeconds ? '2-digit' : undefined, hour12: !prefs.clock24 });
  }, 1000);
  host.on('shell:shortcut', n => {
    if (n === 'terminal') open('org.neoos.terminal'); else if (n === 'files') open('org.neoos.file-manager'); else if (n === 'browser') open('org.neoos.browser');
    else if (n === 'taskmgr') open('org.neoos.task-manager'); else if (n === 'lock') lockSession().catch(() => {});
    else if (n === 'desktop') showDesktop(); else if (n === 'next') cycle(1); else if (n === 'prev') cycle(-1);
  });
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement) || !n.classList.contains('neo-pop') || n.dataset.ext) continue; n.dataset.ext = '1';
    n.querySelectorAll('.neo-ctx__item').forEach(b => { if (b.textContent === 'Quit neoOS') b.textContent = 'Shut down'; });
    const r = document.createElement('button'); r.type = 'button'; r.className = 'neo-ctx__item'; r.textContent = 'Restart';
    r.onclick = () => { n.remove(); restart(); }; n.append(r);
  } }).observe(document.body, { childList: true });
  setTimeout(() => toast({ title: `Welcome, ${user.displayName || user.username}`, message: 'Alt+Space: apps · Ctrl+Alt+T: terminal · Ctrl+Alt+D: show desktop', sound: false }), 900);
}
