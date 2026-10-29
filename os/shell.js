// Shell: top panel, app launcher, dock, desktop icons, context menus and quick settings.
// Pure UI layered over the kernel's public exports; apps never touch any of this.
import { registry, launch, procs, kill, syscalls } from './kernel.js';
import * as wm from './wm.js';
import { alert as showAlert } from './dialogs.js';
import { initNotifications } from './notifications.js';
import { soundsEnabled, setSoundsEnabled } from './sound.js';

const DEFAULT_DOCK = ['org.neoos.file-manager', 'org.neoos.notepad', 'org.neoos.calendar', 'org.neoos.calculator', 'org.neoos.settings'];
const DESKTOP_ICONS = ['org.neoos.file-manager', 'org.neoos.notepad', 'org.neoos.terminal', 'org.neoos.settings'];
const el = (tag, cls = '', text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = u => { const a = el('span', 'neo-avatar', (u.displayName || u.username || '?')[0]); a.style.background = `hsl(${hue(u.username)} 52% 46%)`; return a; };
const appIcon = (app, size) => { const i = new Image(size, size); i.alt = ''; i.draggable = false; i.src = app.base + app.manifest.icon; return i; };
const windowsOf = id => wm.list().filter(w => procs.get(w.pid)?.appId === id);
const zOf = w => parseFloat(w.el.style.zIndex) || 0;

let me = {}, favorites = [], onLockFn, ctx = null, ctxOwner = null, skipToggle = null, launcher = null, dockSig = '';
const $ = id => document.getElementById(id);

/* ---------- context menus and popovers ---------- */
function closeMenus() { ctx?.remove(); ctx = null; ctxOwner?.setAttribute('aria-expanded', 'false'); ctxOwner = null; }
function place(m, x, y) {
  document.body.append(m); const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px'; m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function contextMenu(x, y, items) {
  closeMenus();
  const m = el('div', 'neo-ctx'); m.setAttribute('role', 'menu');
  for (const it of items.filter(Boolean)) {
    if (it === '-') { m.append(el('div', 'neo-ctx__sep')); continue; }
    if (it.header) { m.append(el('div', 'neo-ctx__head', it.header)); continue; }
    const b = el('button', 'neo-ctx__item' + (it.danger ? ' neo-ctx__item--danger' : ''), it.label); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.disabled = !!it.disabled;
    b.onclick = () => { closeMenus(); it.action?.(); }; m.append(b);
  }
  place(m, x, y); ctx = m;
}
document.addEventListener('pointerdown', e => {
  skipToggle = null;
  if (ctx && !ctx.contains(e.target)) { if (ctxOwner?.contains(e.target)) skipToggle = ctxOwner; closeMenus(); }
}, true);
addEventListener('blur', closeMenus); addEventListener('resize', closeMenus);
document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea,[contenteditable]')) e.preventDefault(); });

/* ---------- starting and focusing apps ---------- */
function startApp(id, args) {
  const b = document.querySelector(`.neo-dock__app[data-id="${id}"]`);
  if (b) { b.classList.add('is-launching'); setTimeout(() => b.classList.remove('is-launching'), 600); }
  return launch(id, args).catch(e => showAlert({ title: 'Unable to launch app', message: e.message }));
}
function activate(app) {
  const id = app.manifest.id, ws = windowsOf(id).sort((a, b) => zOf(b) - zOf(a));
  if (!ws.length) return startApp(id);
  if (ws.some(w => w.id === wm.activeId() && !w.min)) { ws.forEach(wm.minimize); wm.focusNext(); } else wm.focus(ws[0]);
}
const quit = id => [...procs.values()].filter(p => p.appId === id).forEach(p => kill(p.pid));
function togglePin(id) { favorites = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]; saveFavorites(); renderDock(); }
function appMenu(app) {
  const id = app.manifest.id, running = [...procs.values()].some(p => p.appId === id), single = app.manifest.instance === 'single';
  return [{ header: app.manifest.name },
    { label: running ? (single ? 'Show' : 'New window') : 'Open', action: () => (running && single ? activate(app) : startApp(id)) }, '-',
    { label: favorites.includes(id) ? 'Remove from dock' : 'Keep in dock', action: () => togglePin(id) },
    running && { label: 'Quit', danger: true, action: () => quit(id) }];
}
function windowMenu(w) {
  return [{ label: w.max ? 'Restore' : 'Maximize', disabled: !w.resizable, action: () => wm.maximize(w) }, { label: 'Minimize', action: () => { wm.minimize(w); wm.focusNext(); } },
    { label: 'Snap left', disabled: !w.resizable, action: () => wm.snap(w, 'left') }, { label: 'Snap right', disabled: !w.resizable, action: () => wm.snap(w, 'right') }, '-',
    { label: 'Close', danger: true, action: () => wm.requestClose(w) }];
}

/* ---------- launcher ---------- */
function closeLauncher() { if (!launcher) return; const l = launcher; launcher = null; l.classList.add('is-closing'); setTimeout(() => l.remove(), 120); }
function openLauncher() {
  if (launcher) return closeLauncher();
  closeMenus();
  const l = el('div', 'neo-launcher'); l.setAttribute('role', 'dialog'); l.setAttribute('aria-label', 'Applications');
  const q = el('input', 'neo-launcher__search'); q.type = 'search'; q.placeholder = 'Search applications'; q.autocomplete = 'off'; q.spellcheck = false; q.setAttribute('aria-label', 'Search applications');
  const grid = el('div', 'neo-launcher__grid'); l.append(q, grid); document.body.append(l); launcher = l;
  let focus = 0, shown = [];
  const mark = () => [...grid.children].forEach((t, i) => t.classList?.toggle('is-focus', i === focus));
  const render = () => {
    const term = q.value.trim().toLowerCase();
    shown = [...registry.values()].filter(a => !term || [a.manifest.name, a.manifest.description, ...(a.manifest.categories || [])].join(' ').toLowerCase().includes(term)).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
    focus = Math.min(focus, Math.max(0, shown.length - 1));
    grid.replaceChildren(...(shown.length ? shown.map(app => {
      const t = el('button', 'neo-tile'); t.type = 'button'; t.title = app.manifest.description; t.append(appIcon(app, 58), el('span', '', app.manifest.name));
      t.onclick = () => { closeLauncher(); startApp(app.manifest.id); };
      t.oncontextmenu = e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, appMenu(app)); }; return t;
    }) : [el('div', 'neo-launcher__empty', `No applications match “${q.value}”.`)]));
    mark();
  };
  q.oninput = () => { focus = 0; render(); };
  l.onpointerdown = e => { if (e.target === l || e.target === grid) closeLauncher(); };
  l.onkeydown = e => {
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length), step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (step) { e.preventDefault(); focus = Math.min(shown.length - 1, Math.max(0, focus + step)); mark(); grid.children[focus]?.scrollIntoView?.({ block: 'nearest' }); }
    else if (e.key === 'Enter' && shown[focus]) { e.preventDefault(); closeLauncher(); startApp(shown[focus].manifest.id); }
    else if (e.key === 'Escape') { e.stopPropagation(); closeLauncher(); }
  };
  render(); q.focus();
}

/* ---------- dock ---------- */
const favKey = () => `neoos.dock.${me.id || 'default'}`;
function loadFavorites() {
  let f; try { f = JSON.parse(localStorage.getItem(favKey()) || 'null'); } catch { f = null; }
  favorites = [...new Set(Array.isArray(f) ? f : DEFAULT_DOCK)].filter(id => registry.has(id));
}
const saveFavorites = () => { try { localStorage.setItem(favKey(), JSON.stringify(favorites)); } catch {} };
function dockButton(app) {
  const b = el('button', 'neo-dock__app'); b.type = 'button'; b.dataset.id = app.manifest.id; b.title = app.manifest.name; b.setAttribute('aria-label', app.manifest.name);
  b.append(appIcon(app, 36)); b.onclick = () => activate(app); b.oncontextmenu = e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, appMenu(app)); }; return b;
}
function renderDock() {
  const dock = $('dock'), extra = [];
  for (const w of wm.list()) { const id = procs.get(w.pid)?.appId; if (id && registry.has(id) && !favorites.includes(id) && !extra.includes(id)) extra.push(id); }
  const sig = favorites.join() + '|' + extra.join();
  if (sig !== dockSig) {
    dockSig = sig; const nodes = favorites.map(id => dockButton(registry.get(id)));
    if (extra.length) nodes.push(el('div', 'neo-dock__sep'), ...extra.map(id => dockButton(registry.get(id))));
    const grid = el('button', 'neo-dock__app neo-dock__grid', '⠿'); grid.type = 'button'; grid.title = 'Show applications (Alt+Space)'; grid.setAttribute('aria-label', 'Show applications'); grid.onclick = openLauncher;
    dock.replaceChildren(...nodes, el('div', 'neo-dock__sep'), grid);
  }
  const act = wm.list().find(w => w.id === wm.activeId() && !w.min), activeId = act && procs.get(act.pid)?.appId, running = new Set([...procs.values()].map(p => p.appId));
  dock.querySelectorAll('.neo-dock__app[data-id]').forEach(b => { b.dataset.running = running.has(b.dataset.id); b.dataset.active = b.dataset.id === activeId; });
}

/* ---------- panel and quick settings ---------- */
const logoSrc = () => (document.documentElement.dataset.theme === 'light' ? 'branding/neoicon.png' : 'branding/neoiconwhite.png');
function openQuick(btn) {
  if (skipToggle === btn) { skipToggle = null; return; }
  closeMenus();
  const m = el('div', 'neo-ctx neo-pop'), head = el('div', 'neo-pop__user'), info = el('div');
  info.append(el('strong', '', me.displayName || me.username), el('div', 'u-muted', `@${me.username} · ${me.role}`)); head.append(avatar(me), info);
  const seg = (labels, current, onPick) => { const s = el('div', 'neo-segmented'); for (const [value, label] of labels) { const b = el('button', value === current ? 'is-active' : '', label); b.type = 'button'; b.onclick = () => { onPick(value); s.querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x === b)); }; s.append(b); } return s; };
  const themeRow = el('div', 'neo-pop__row'); themeRow.append(el('span', '', 'Appearance'), seg([['dark', 'Dark'], ['light', 'Light']], syscalls['theme.get'].fn(), v => syscalls['theme.set'].fn({ user: me }, v)));
  const soundRow = el('div', 'neo-pop__row'); soundRow.append(el('span', '', 'System sounds'), seg([[true, 'On'], [false, 'Off']], soundsEnabled(), v => setSoundsEnabled(v)));
  const item = (label, action) => { const b = el('button', 'neo-ctx__item', label); b.type = 'button'; b.onclick = () => { closeMenus(); action(); }; return b; };
  m.append(head, themeRow, soundRow, el('div', 'neo-ctx__sep'));
  if (registry.has('org.neoos.settings')) m.append(item('Settings…', () => startApp('org.neoos.settings')));
  if (registry.has('org.neoos.system-monitor')) m.append(item('System Monitor…', () => startApp('org.neoos.system-monitor')));
  m.append(item('Lock screen', lock));
  m.style.top = '36px'; m.style.right = '8px'; document.body.append(m); ctx = m; ctxOwner = btn; btn.setAttribute('aria-expanded', 'true');
}
async function lock() {
  try { const next = await onLockFn?.(); if (next) setUser(next); }
  catch (error) { await showAlert({ title: 'Unable to lock session', message: error.message }); }
}
function setUser(u) { me = u; loadFavorites(); dockSig = ''; buildTray(); renderDock(); }
let tray, appName, logo, clockBtn;
function buildTray() { tray.replaceChildren(avatar(me), el('span', '', me.displayName || me.username)); }
function refresh() {
  const w = wm.list().find(x => x.id === wm.activeId()), app = w && registry.get(procs.get(w.pid)?.appId);
  appName.textContent = app?.manifest.name || 'neoOS'; logo.src = logoSrc(); renderDock();
}

/* ---------- desktop ---------- */
function buildDesktop() {
  const desktop = $('desktop'), host = el('div', 'neo-icons'); desktop.prepend(host);
  const select = b => host.querySelectorAll('.neo-icon').forEach(x => x.classList.toggle('is-selected', x === b));
  for (const id of DESKTOP_ICONS) {
    const app = registry.get(id); if (!app) continue;
    const b = el('button', 'neo-icon'); b.type = 'button'; b.dataset.id = id; b.append(appIcon(app, 44), el('span', '', app.manifest.name));
    b.onclick = () => select(b); b.onfocus = () => select(b); b.ondblclick = () => startApp(id); host.append(b);
  }
  desktop.addEventListener('pointerdown', e => { if (!e.target.closest('.neo-icon')) select(null); });
  desktop.addEventListener('contextmenu', e => {
    e.preventDefault();
    const winEl = e.target.closest('.neo-win');
    if (winEl) { const w = wm.list().find(x => x.el === winEl); if (w && e.target.closest('.neo-win__bar')) contextMenu(e.clientX, e.clientY, windowMenu(w)); return; }
    const icon = e.target.closest('.neo-icon'); if (icon) { select(icon); contextMenu(e.clientX, e.clientY, appMenu(registry.get(icon.dataset.id))); return; }
    const entry = (label, id) => registry.has(id) && { label, action: () => startApp(id) };
    contextMenu(e.clientX, e.clientY, [entry('Open File Manager', 'org.neoos.file-manager'), entry('Open Terminal', 'org.neoos.terminal'), '-', entry('Change wallpaper…', 'org.neoos.settings'), entry('About neoOS', 'org.neoos.about'), '-', { label: 'Lock screen', action: lock }]);
  });
}

export function initShell({ user, onLock } = {}) {
  initNotifications(); onLockFn = onLock; me = user || {};
  const panel = $('panel'), dock = $('dock');
  const left = el('div', 'neo-panel__side'), center = el('div', 'neo-panel__side'), right = el('div', 'neo-panel__side neo-panel__side--end');
  const launchBtn = el('button', 'neo-panel__btn'); launchBtn.type = 'button'; launchBtn.title = 'Applications (Alt+Space)'; launchBtn.setAttribute('aria-label', 'Applications');
  logo = new Image(16, 16); logo.alt = ''; appName = el('span', 'neo-panel__app', 'neoOS'); launchBtn.append(logo, appName); launchBtn.onclick = openLauncher; left.append(launchBtn);
  clockBtn = el('button', 'neo-panel__btn'); clockBtn.type = 'button'; clockBtn.title = 'Open Calendar'; clockBtn.onclick = () => registry.has('org.neoos.calendar') && startApp('org.neoos.calendar'); center.append(clockBtn);
  tray = el('button', 'neo-panel__btn'); tray.type = 'button'; tray.setAttribute('aria-haspopup', 'menu'); tray.setAttribute('aria-expanded', 'false'); tray.onclick = () => openQuick(tray); right.append(tray);
  panel.replaceChildren(left, center, right); panel.hidden = false; dock.hidden = false;
  buildDesktop(); loadFavorites(); buildTray(); refresh();
  wm.hooks.onChange = refresh;
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenus(); closeLauncher(); }
    else if (e.altKey && e.code === 'Space') { e.preventDefault(); openLauncher(); }
  });
  const tick = () => { clockBtn.textContent = new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  tick(); setInterval(tick, 5000);
}
