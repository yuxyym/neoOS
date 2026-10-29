// System sounds (freedesktop theme in resources/sounds). Kept dependency-free so any module can import it.
const KEY = 'neoos.sounds';
export const soundsEnabled = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const setSoundsEnabled = on => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} };
export function playSound(name) {
  if (!soundsEnabled()) return;
  try { const a = new Audio(`resources/sounds/freedesktop/${name}.oga`); a.volume = .5; a.play().catch(() => {}); } catch {}
}
