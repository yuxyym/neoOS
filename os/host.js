// Renderer-side wrapper for the Electron preload bridge (window.neoHost). Only the kernel, shell and extras import this.
const bridge = globalThis.neoHost;
export const available = !!bridge;
export const hooks = {}; // hooks.bounds(id, bounds, send) lets os/extras.js intercept native browser view placement
export async function callRaw(channel, ...args) {
  if (!bridge) throw Object.assign(new Error('This feature needs the neoOS Electron shell (npm start).'), { code: 'ENOSYS' });
  const r = await bridge.call(channel, ...args);
  if (!r?.ok) throw Object.assign(new Error(r?.error?.message || 'Host call failed'), { code: r?.error?.code || 'EIO' });
  return r.result;
}
export function call(channel, ...args) {
  if (channel === 'browser:bounds' && hooks.bounds) return hooks.bounds(args[0], args[1] || {}, (i, b) => callRaw(channel, i, b));
  return callRaw(channel, ...args);
}
export const post = (channel, ...args) => bridge?.post(channel, ...args); // fire and forget
export const on = (channel, fn) => bridge?.on(channel, fn);
