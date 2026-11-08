// System integration: links the shell to the real computer (volume, Wi-Fi, Bluetooth, power), adds the system-wide
// file-association store, hardware volume keys, and real power items in the quick menu.
import * as host from './host.js';
import { syscalls } from './kernel.js';
import { confirm, alert as showAlert } from './dialogs.js';
import { toast } from './notifications.js';

const call = (a, args = {}) => host.call('sys:call', a, args);
const ls = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
const assocKey = id => `neoos.assoc.${id}`;
const readAssoc = id => { try { return JSON.parse(localStorage.getItem(assocKey(id)) || '{}'); } catch { return {}; } };
let info = { session: false }; const last = {};

/* File associations are system-wide: File Manager's "open with" memory is redirected to this store, and Settings edits it. */
syscalls['sysctl.call'] = { scope: 'system.control', fn: (p, a, args) => call(String(a), args) };
syscalls['assoc.get'] = { fn: p => readAssoc(p.user.id) };
syscalls['assoc.set'] = { scope: 'system.control', fn: (p, ext, appId) => {
  ext = String(ext || '').replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9_+-]{1,16}$/.test(ext)) throw Object.assign(new Error('Invalid extension'), { code: 'EINVAL' });
  const m = readAssoc(p.user.id); appId ? (m[ext] = String(appId)) : delete m[ext]; ls(assocKey(p.user.id), JSON.stringify(m)); return m;
} };
{
  const g = syscalls['storage.get'], s = syscalls['storage.set'], fm = (p, k) => p.appId === 'org.neoos.file-manager' && k === 'openwith';
  syscalls['storage.get'] = { ...g, fn: (p, k) => (fm(p, k) ? localStorage.getItem(assocKey(p.user.id)) || '{}' : g.fn(p, k)) };
  syscalls['storage.set'] = { ...s, fn: (p, k, v) => (fm(p, k) ? ls(assocKey(p.user.id), v) : s.fn(p, k, v)) };
}

function paint() {
  const pills = document.querySelectorAll('.neo-panel__status:not(.neo-panel__status--menu) .neo-status-pill');
  if (pills.length < 3) return;
  if (last.wifi) pills[0].textContent = last.wifi.enabled ? (last.wifi.ssid || 'Wi‑Fi') : 'Wi‑Fi off';
  if (last.vol) pills[2].textContent = last.vol.muted ? 'Muted' : `Vol ${last.vol.volume}%`;
}
async function poll() {
  try { const v = last.vol = await call('volume.get'); ls('neoos.volume', v.volume); syscalls['prefs.set'].fn(null, { volume: v.volume }); } catch {}
  try { const w = await call('wifi.status'); if (w.supported) { last.wifi = w; ls('neoos.wifi', w.enabled ? 'on' : 'off'); } } catch {}
  try { const b = await call('bt.status'); if (b.supported) ls('neoos.bluetooth', b.enabled ? 'on' : 'off'); } catch {}
  paint();
}
async function power(kind) {
  const text = { restart: ['Restart computer', 'Your computer will restart now. Unsaved work will be lost.'], shutdown: ['Shut down computer', 'Your computer will shut down now. Unsaved work will be lost.'] }[kind];
  if (text && !await confirm({ title: text[0], message: text[1] })) return;
  try { await call('power.' + kind); } catch (e) { showAlert({ title: 'Unable to ' + kind, message: e.message }); }
}
function bind(b) {
  const bt = /^Bluetooth/.test(b.textContent), label = bt ? 'Bluetooth' : 'Wi‑Fi'; let en = null;
  call(bt ? 'bt.status' : 'wifi.status').then(s => { if (s.supported) { en = s.enabled; b.textContent = `${label}: ${en ? 'On' : 'Off'}`; } }).catch(() => {});
  b.addEventListener('click', () => {
    if (en == null) return; const want = !en;
    call(bt ? 'bt.power' : 'wifi.power', { on: want }).then(() => { en = want; }).catch(e => { toast({ title: label, message: e.message, sound: false }); });
    b.textContent = `${label}: ${want ? 'On' : 'Off'}`;
  });
}
function enhance(n) {
  for (const b of [...n.querySelectorAll('.neo-ctx__item')]) {
    const t = b.textContent;
    if (t === 'Restart') b.remove();
    else if (t === 'Shut down') info.session ? b.remove() : (b.textContent = 'Quit neoOS');
    else if (t === 'Quit neoOS' && info.session) b.remove();
    else if (/^(Wi.Fi|Bluetooth):/.test(t)) bind(b);
  }
  const r = n.querySelector('.neo-pop__range');
  if (r) {
    if (last.vol) r.value = last.vol.volume; let tm;
    call('volume.get').then(v => { last.vol = v; r.value = v.volume; }).catch(() => {});
    r.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => call('volume.set', { volume: +r.value }).then(() => { last.vol = { ...last.vol, volume: +r.value }; ls('neoos.volume', r.value); paint(); }).catch(() => {}), 120); });
  }
  const add = (label, fn, danger) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'neo-ctx__item' + (danger ? ' neo-ctx__item--danger' : ''); x.textContent = label; x.onclick = () => { n.remove(); fn(); }; n.append(x); };
  add('Sleep', () => power('sleep')); add('Restart computer…', () => power('restart')); add('Shut down computer…', () => power('shutdown'), true);
}
export async function initSystem() {
  try { info = await call('info'); } catch { return; }
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
    if (n instanceof HTMLElement && n.classList.contains('neo-pop') && !n.dataset.sys) { n.dataset.sys = '1'; enhance(n); }
  } }).observe(document.body, { childList: true });
  addEventListener('keydown', async e => { // hardware volume keys
    const m = /^AudioVolume(Up|Down|Mute)$/.exec(e.key); if (!m) return; e.preventDefault();
    try {
      const v = last.vol || await call('volume.get');
      if (m[1] === 'Mute') { v.muted = !v.muted; await call('volume.mute', { muted: v.muted }); }
      else { v.volume = Math.min(100, Math.max(0, v.volume + (m[1] === 'Up' ? 5 : -5))); v.muted = false; await call('volume.set', { volume: v.volume }); }
      last.vol = v; ls('neoos.volume', v.volume); paint(); toast({ title: 'Volume', message: v.muted ? 'Muted' : v.volume + '%', sound: false, timeout: 1200 });
    } catch {}
  });
  poll(); setInterval(poll, 15000);
}
