// System sounds (freedesktop theme in resources/sounds). Honors the system volume (localStorage "neoos.volume", 0-100).
const KEY = 'neoos.sounds';
export const soundsEnabled = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const setSoundsEnabled = on => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} };
export function playSound(name) {
  if (!soundsEnabled()) return;
  try {
    let v = NaN; try { v = parseFloat(localStorage.getItem('neoos.volume')); } catch {}
    const a = new Audio(`resources/sounds/freedesktop/${name}.oga`); a.volume = Math.min(1, Math.max(0, (Number.isFinite(v) ? v : 68) / 100)); a.play().catch(() => {});
  } catch {}
}
