// Notification toasts plus the `notify.show` syscall. Registered at shell start so it can extend the kernel's syscall table.
import { syscalls, log } from './kernel.js';
import { playSound } from './sound.js';

const MAX_TOASTS = 4;
export function toast({ title = '', message = '', icon = 'branding/neoiconwhite.png', sound = 'message-new-instant', timeout = 6000 } = {}) {
  const host = document.getElementById('toasts'); if (!host) return;
  while (host.children.length >= MAX_TOASTS) host.firstElementChild.remove();
  const el = document.createElement('div'); el.className = 'neo-toast'; el.setAttribute('role', 'status');
  const img = new Image(); img.alt = ''; img.src = icon; img.onerror = () => { img.style.visibility = 'hidden'; };
  const body = document.createElement('div'), h = document.createElement('strong'), p = document.createElement('p');
  h.textContent = title; p.textContent = message; body.append(h); if (message) body.append(p); el.append(img, body); host.append(el);
  const dismiss = () => { if (el.classList.contains('is-leaving')) return; el.classList.add('is-leaving'); setTimeout(() => el.remove(), 200); };
  el.onclick = dismiss; setTimeout(dismiss, timeout);
  if (sound) playSound(sound);
}
export function initNotifications() {
  syscalls['notify.show'] = { fn: (p, o = {}) => {
    const sound = o.sound === false ? null : o.sound === 'alarm' ? 'alarm-clock-elapsed' : 'message-new-instant';
    toast({ title: String(o.title || p.manifest.name).slice(0, 80), message: String(o.message || '').slice(0, 300), icon: p.base + p.manifest.icon, sound });
    log('info', p.appId, 'notification shown'); return true;
  } };
}
