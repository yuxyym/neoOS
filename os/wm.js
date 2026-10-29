// Window manager: owns window chrome and sandboxed content frames. Knows nothing about apps.
// Geometry lives in inline styles (left/top/width/height). Maximize and edge-snap remember the floating rect in `w.prev`.
const wins = new Map(); let z = 10, nid = 1, active = null, themeName = 'dark', snapEl = null;
export const hooks = {};
const chg = () => hooks.onChange?.();
export const list = () => [...wins.values()];
export const get = id => wins.get(id);
export const activeId = () => active;

const cssPx = (name, fallback) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
const area = () => { const top = cssPx('--neo-panel-h', 32), bottom = cssPx('--neo-dock-reserve', 78); return { top, width: innerWidth, height: Math.max(160, innerHeight - top - bottom) }; };
const num = v => parseFloat(v) || 0;
const rect = el => ({ left: num(el.style.left), top: num(el.style.top), width: num(el.style.width), height: num(el.style.height) });
const put = (el, r) => { el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; el.style.width = r.width + 'px'; el.style.height = r.height + 'px'; };
const I = {
  min: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M1 5h8"/></svg>',
  max: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1" y="1" width="8" height="8" rx="1"/></svg>',
  rest: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1" y="3" width="6" height="6" rx="1"/><path d="M3 3V1.5A.5.5 0 0 1 3.5 1H8.5a.5.5 0 0 1 .5.5V6.5a.5.5 0 0 1-.5.5H7"/></svg>',
  close: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M1 1l8 8M9 1 1 9"/></svg>',
};
const maxIcon = w => { const b = w.el.querySelector('[data-a=max]'); b.innerHTML = w.max ? I.rest : I.max; b.setAttribute('aria-label', w.max ? 'Restore' : 'Maximize'); };
const zOf = w => num(w.el.style.zIndex);

export function create(proc, o, doc) {
  const desk = document.getElementById('desktop'), a = area();
  const w = { id: nid++, pid: proc.pid, title: o.title || 'Untitled', min: false, max: false, snapped: null, prev: null, guard: false, top: !!o.alwaysOnTop, resizable: o.resizable !== false };
  const el = w.el = document.createElement('div');
  el.className = 'neo-win'; el.dataset.wid = w.id;
  el.innerHTML = `<div class="neo-win__bar"><img class="neo-win__icon" alt="" draggable="false"><span class="neo-win__title"></span><span class="neo-win__tools"></span><div class="neo-win__ctl"><button type="button" data-a="min" aria-label="Minimize">${I.min}</button><button type="button" data-a="max" aria-label="Maximize">${I.max}</button><button type="button" data-a="close" aria-label="Close">${I.close}</button></div></div><div class="neo-win__body"><div class="neo-win__shield"></div></div>`;
  const icon = el.querySelector('.neo-win__icon'); icon.onerror = () => { icon.style.visibility = 'hidden'; }; icon.src = proc.base + proc.manifest.icon;
  const W = Math.min(o.width || 640, a.width - 8), H = Math.min(o.height || 480, a.height), cascade = (nid % 6) * 26;
  put(el, { left: Math.max(0, Math.min((a.width - W) / 2 + cascade - 65, a.width - W)), top: a.top + Math.max(0, Math.min((a.height - H) / 2 + cascade - 65, a.height - H)), width: W, height: H });
  el.style.minWidth = Math.min(o.minWidth || 240, a.width) + 'px'; el.style.minHeight = Math.min(o.minHeight || 140, a.height) + 'px';
  const fr = document.createElement('iframe'), remoteUrl = o.remoteUrl;
  fr.sandbox = remoteUrl ? 'allow-scripts allow-forms allow-same-origin' : 'allow-scripts allow-forms'; // remote editors keep their own origin; local apps stay opaque-origin
  if (remoteUrl) { fr.allow = 'clipboard-read; clipboard-write'; fr.referrerPolicy = 'no-referrer'; }
  fr.title = w.title; w.frame = fr;
  const ch = new MessageChannel(); w.port = ch.port1;
  ch.port1.onmessage = e => hooks.onMessage?.(w, e.data);
  if (remoteUrl) {
    w.remoteOrigin = new URL(remoteUrl).origin;
    fr.onerror = () => hooks.onRemoteError?.(w); fr.onload = () => hooks.onRemoteReady?.(w); fr.src = remoteUrl;
  } else {
    fr.srcdoc = doc;
    fr.onload = () => fr.contentWindow.postMessage({ neo: 'hello', theme: themeName }, '*', [ch.port2]);
  }
  el.querySelector('.neo-win__body').prepend(fr);
  setTitle(w, w.title);
  const bar = el.querySelector('.neo-win__bar'), tools = el.querySelector('.neo-win__tools');
  const tool = (label, tip, action) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'neo-win__tool'; b.textContent = label; b.title = tip; b.onclick = e => { e.stopPropagation(); hooks.onAction?.(w, action); }; tools.append(b); };
  if (o.openFileAction) tool('Open', 'Open a file from neoOS Files', 'open-file');
  if (o.saveFileAction) tool('Save', 'Save the edited file into neoOS Files', 'save-file');
  if (!w.resizable) el.querySelector('[data-a=max]').disabled = true;
  el.querySelector('.neo-win__ctl').onclick = e => {
    const act = e.target.closest('button')?.dataset.a; if (!act) return;
    if (act === 'close') requestClose(w); else if (act === 'min') { minimize(w); focusNext(); } else maximize(w);
  };
  bar.ondblclick = e => { if (!e.target.closest('button')) maximize(w); };
  bar.onpointerdown = e => startDrag(w, bar, e);
  el.querySelector('.neo-win__shield').onpointerdown = e => { e.preventDefault(); focus(w); fr.focus(); };
  if (w.resizable) for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) { const h = document.createElement('i'); h.className = 'neo-win__rz'; h.dataset.d = d; h.onpointerdown = e => startResize(w, d, h, e); el.append(h); }
  desk.append(el); wins.set(w.id, w); focus(w); return w;
}

function startDrag(w, bar, e) {
  focus(w);
  if (e.button !== 0 || e.target.closest('button')) return;
  const el = w.el; let ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop, moved = false, zone = null;
  const sx = e.clientX, sy = e.clientY;
  bar.setPointerCapture(e.pointerId);
  bar.onpointermove = m => {
    if (!moved) {
      if (Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      moved = true; el.classList.add('is-dragging');
      if (w.max || w.snapped) { // pull a maximized/snapped window back to its floating size under the cursor
        const prev = w.prev || rect(el), ratio = Math.min(1, Math.max(0, (sx - el.offsetLeft) / el.offsetWidth));
        clearState(w); put(el, { ...prev, left: m.clientX - prev.width * ratio, top: m.clientY - 18 }); ox = prev.width * ratio; oy = 18;
      }
    }
    const a = area();
    el.style.left = m.clientX - ox + 'px'; el.style.top = Math.min(Math.max(a.top, m.clientY - oy), innerHeight - 44) + 'px';
    zone = w.resizable ? (m.clientY <= a.top + 4 ? 'max' : m.clientX <= 3 ? 'left' : m.clientX >= innerWidth - 4 ? 'right' : null) : null;
    showSnap(zone);
  };
  bar.onpointerup = bar.onpointercancel = () => {
    bar.onpointermove = bar.onpointerup = bar.onpointercancel = null; el.classList.remove('is-dragging'); showSnap(null);
    if (moved && zone) snapTo(w, zone);
  };
}
function startResize(w, d, h, e) {
  if (e.button !== 0) return; e.preventDefault(); focus(w);
  if (w.snapped) clearState(w);
  const el = w.el, r0 = rect(el), sx = e.clientX, sy = e.clientY, a = area(), cs = getComputedStyle(el), minW = num(cs.minWidth), minH = num(cs.minHeight);
  h.setPointerCapture(e.pointerId); el.classList.add('is-dragging');
  h.onpointermove = m => {
    const dx = m.clientX - sx, dy = m.clientY - sy; let { left, top, width, height } = r0;
    if (d.includes('e')) width = Math.max(minW, r0.width + dx);
    if (d.includes('s')) height = Math.max(minH, r0.height + dy);
    if (d.includes('w')) { width = Math.max(minW, r0.width - dx); left = r0.left + r0.width - width; }
    if (d.includes('n')) { height = Math.max(minH, r0.height - dy); top = r0.top + r0.height - height; if (top < a.top) { height -= a.top - top; top = a.top; } }
    put(el, { left, top, width, height });
  };
  h.onpointerup = h.onpointercancel = () => { h.onpointermove = h.onpointerup = h.onpointercancel = null; el.classList.remove('is-dragging'); };
}
function showSnap(zone) {
  if (!zone) { snapEl?.remove(); snapEl = null; return; }
  const a = area(), r = zone === 'max' ? { left: 6, top: a.top + 6, width: a.width - 12, height: a.height - 12 } : { left: zone === 'left' ? 6 : a.width / 2 + 2, top: a.top + 6, width: a.width / 2 - 8, height: a.height - 12 };
  if (!snapEl) { snapEl = document.createElement('div'); snapEl.className = 'neo-snap'; document.body.append(snapEl); }
  put(snapEl, r);
}
function clearState(w) { w.max = false; w.snapped = null; w.el.classList.remove('is-max', 'is-snapped'); maxIcon(w); }
function fit(w) {
  const a = area();
  if (w.max) put(w.el, { left: 0, top: a.top, width: a.width, height: a.height });
  else if (w.snapped) put(w.el, { left: w.snapped === 'left' ? 0 : a.width / 2, top: a.top, width: a.width / 2, height: a.height });
  else { const r = rect(w.el); put(w.el, { ...r, left: Math.min(Math.max(r.left, 80 - r.width), a.width - 80), top: Math.min(Math.max(r.top, a.top), innerHeight - 60) }); }
}
function snapTo(w, zone) {
  if (!w.resizable) return;
  if (!w.max && !w.snapped) w.prev = rect(w.el);
  if (zone === 'max') { w.max = true; w.snapped = null; w.el.classList.add('is-max'); w.el.classList.remove('is-snapped'); }
  else { w.max = false; w.snapped = zone; w.el.classList.add('is-snapped'); w.el.classList.remove('is-max'); }
  maxIcon(w); fit(w); focus(w);
}
addEventListener('resize', () => wins.forEach(fit));
// Clicking into an iframe blurs the host page; the focused iframe tells us which window to raise (no click-swallowing overlay needed).
addEventListener('blur', () => setTimeout(() => { const w = list().find(x => x.frame === document.activeElement); if (w && active !== w.id) focus(w); }, 0));

export function setTitle(w, t) { w.title = String(t); w.el.querySelector('.neo-win__title').textContent = w.title; w.frame.title = w.title; chg(); }
export function resize(w, a, b) { if (w.max || w.snapped) clearState(w); w.el.style.width = a + 'px'; w.el.style.height = b + 'px'; }
export function move(w, x, y) { if (w.max || w.snapped) clearState(w); w.el.style.left = x + 'px'; w.el.style.top = Math.max(area().top, y) + 'px'; }
export function focus(w) {
  const was = w.min; w.min = false; w.el.hidden = false; w.el.style.zIndex = ++z + (w.top ? 10000 : 0);
  if (was) { w.el.classList.remove('is-minimizing'); w.el.classList.add('is-restoring'); setTimeout(() => w.el.classList.remove('is-restoring'), 220); }
  wins.forEach(o => o.el.classList.toggle('is-active', o === w)); active = w.id; chg();
}
export function focusNext() {
  const next = list().filter(o => !o.min).sort((a, b) => zOf(b) - zOf(a))[0]; if (next) focus(next);
}
export function minimize(w) {
  if (w.min) return; w.min = true; w.el.classList.remove('is-active'); w.el.classList.add('is-minimizing');
  if (active === w.id) active = null;
  setTimeout(() => { w.el.classList.remove('is-minimizing'); if (w.min) w.el.hidden = true; }, 180); chg();
}
export function maximize(w) { if (!w.resizable) return; if (w.max) restore(w); else snapTo(w, 'max'); }
export function restore(w) { const prev = w.prev; clearState(w); if (prev) put(w.el, prev); fit(w); focus(w); }
export function snap(w, zone) { snapTo(w, zone); }
export function setTop(w, v) { w.top = !!v; focus(w); }
export function requestClose(w) { w.guard ? hooks.onBeforeClose?.(w) : close(w); }
export function close(w, silent) {
  if (!wins.delete(w.id)) return;
  const was = active === w.id; w.port.close(); if (was) active = null;
  w.el.classList.add('is-closing'); setTimeout(() => w.el.remove(), silent ? 0 : 130);
  chg(); if (!silent) { hooks.onClose?.(w); if (was) focusNext(); }
}
export function setTheme(name) { themeName = name; wins.forEach(w => w.port.postMessage({ __theme: name })); }
