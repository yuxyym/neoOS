// Desktop extras: per-user UI settings (interface scale, auto-lock, Do Not Disturb), startup apps,
// account management syscalls, and live discovery of new folders in /applications.
import { syscalls, registry, scanApps, currentUser, lockSession, activeWindowIsEmbedded, log } from './kernel.js';
import * as host from './host.js';
import * as accounts from './accounts.js';

const DEFAULTS = { uiScale: 100, autoLock: 0, dnd: false };
const AUTOLOCK = [0, 1, 2, 5, 10, 15, 30, 60];
const uidNow = () => currentUser?.id || 'default';
const read = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...d }; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const getUi = (uid = uidNow()) => read(`neoos.ui.${uid}`, DEFAULTS);
const getStartup = (uid = uidNow()) => read(`neoos.startup.${uid}`, {});
export const shouldAutostart = (user, manifest) => { const s = getStartup(user.id); return manifest.id in s ? !!s[manifest.id] : !!manifest.autostart; };

let idleSince = Date.now();
const touch = () => { idleSince = Date.now(); };
export function applyUi(ui = getUi()) {
  const f = ui.uiScale / 100;
  window.__neoZoom = f;
  host.call('ui:zoom', f).catch(() => {});
  setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  try { localStorage.setItem('neoos.dnd', ui.dnd ? '1' : '0'); } catch {}
}
export function sanitizeUi(patch) {
  const out = {};
  if (patch && typeof patch === 'object') {
    if ('uiScale' in patch) out.uiScale = Math.min(200, Math.max(75, Math.round(Number(patch.uiScale) / 5) * 5 || 100));
    if ('autoLock' in patch) { const v = Math.round(Number(patch.autoLock)); out.autoLock = AUTOLOCK.includes(v) ? v : 0; }
    if ('dnd' in patch) out.dnd = !!patch.dnd;
  }
  return out;
}

const selfOrAdmin = (p, id) => { if (id !== p.user.id && p.user.role !== 'admin') throw Object.assign(new Error('Only an administrator can manage other accounts'), { code: 'EPERM' }); };
syscalls['ui.get'] = { fn: () => getUi() };
syscalls['ui.set'] = { scope: 'desktop.customize', fn: (p, patch) => { const ui = { ...getUi(), ...sanitizeUi(patch) }; write(`neoos.ui.${p.user.id}`, ui); applyUi(ui); return ui; } };
syscalls['startup.get'] = { scope: 'system.control', fn: () => { const s = getStartup(), out = {}; for (const a of registry.values()) out[a.manifest.id] = a.manifest.id in s ? !!s[a.manifest.id] : !!a.manifest.autostart; return out; } };
syscalls['startup.set'] = { scope: 'system.control', fn: (p, id, on) => {
  id = String(id); if (!registry.has(id)) throw Object.assign(new Error('No such app'), { code: 'ENOENT' });
  const s = getStartup(p.user.id); s[id] = !!on; write(`neoos.startup.${p.user.id}`, s); return true;
} };
syscalls['account.changePassword'] = { scope: 'account.manage', fn: async (p, o = {}) => { await accounts.changePassword(p.user.id, o.oldPassword, o.newPassword); return true; } };
syscalls['account.rename'] = { scope: 'account.manage', fn: (p, o = {}) => {
  selfOrAdmin(p, o.id); const u = accounts.renameAccount(o.id, o.displayName);
  if (currentUser && currentUser.id === u.id) currentUser.displayName = u.displayName; return u;
} };
syscalls['account.remove'] = { scope: 'account.manage', fn: (p, o = {}) => {
  if (p.user.role !== 'admin') throw Object.assign(new Error('Only an administrator can remove accounts'), { code: 'EPERM' });
  if (o.id === p.user.id) throw Object.assign(new Error('You cannot remove the account you are signed in to'), { code: 'EPERM' });
  return accounts.removeAccount(o.id);
} };

export function initDesktopExtras() {
  applyUi();
  // Activity from inside app windows arrives as {neoActivity:1} messages (see sdk/neo-frame.js).
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) addEventListener(ev, touch, { capture: true, passive: true });
  addEventListener('message', e => { if (e.data && e.data.neoActivity === 1) touch(); });
  setInterval(() => {
    const minutes = getUi().autoLock;
    if (!minutes || document.querySelector('.neo-lock') || activeWindowIsEmbedded()) return;
    if (Date.now() - idleSince >= minutes * 60000) { touch(); log('info', 'desktop', 'auto-lock'); lockSession().catch(() => {}); }
  }, 10000);
  setInterval(() => { scanApps().catch(() => {}); }, 5000); // new folders in /applications show up without a restart
}
