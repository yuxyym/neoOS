// Renderer-side wrapper for the Electron preload bridge (window.neoHost). Only the kernel and shell import this.
const bridge = globalThis.neoHost;
export const available = !!bridge;
export async function call(channel, ...args) {
  if (!bridge) throw Object.assign(new Error('This feature needs the neoOS Electron shell (npm start).'), { code: 'ENOSYS' });
  const r = await bridge.call(channel, ...args);
  if (!r?.ok) throw Object.assign(new Error(r?.error?.message || 'Host call failed'), { code: r?.error?.code || 'EIO' });
  return r.result;
}
export const on = (channel, fn) => bridge?.on(channel, fn);
