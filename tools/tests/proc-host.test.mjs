// Runs electron/proc-host.js with a fake Electron parentPort and a fake kernel, then loads real app mains.
// Usage: node tools/tests/proc-host.test.mjs
import { createRequire } from 'node:module'; import { EventEmitter } from 'node:events'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function runApp(dir, handlers, drive) {
  const port = new EventEmitter(), sent = [];
  port.postMessage = m => { sent.push(m); if (m.id) { const h = handlers[`${m.api}.${m.method}`]; let res; try { res = { id: m.id, ok: true, result: h ? h(...m.args) : null }; } catch (e) { res = { id: m.id, ok: false, error: { code: 'EX', message: e.message } }; } setTimeout(() => port.emit('message', { data: res }), 0); } };
  process.parentPort = port; process.env.NEOOS_ENTRY = path.join(root, 'applications', dir, 'main.js');
  const hostPath = path.join(root, 'electron/proc-host.js'); delete require.cache[hostPath]; delete require.cache[process.env.NEOOS_ENTRY];
  const before = process.listeners('uncaughtException').length; require(hostPath);
  const emit = d => port.emit('message', { data: d }), wait = ms => new Promise(r => setTimeout(r, ms));
  emit({ neo: 'hello', pid: 7, manifest: { id: 'x' }, theme: 'metro' }); await wait(20);
  await drive({ emit, wait, sent });
  process.removeAllListeners('uncaughtException'); process.removeAllListeners('unhandledRejection'); return sent;
}
// 1. text-editor: window.create is called and handle works
let s = await runApp('text-editor', { 'window.create': () => 42 }, async () => {});
assert(s.some(m => m.api === 'window' && m.method === 'create'), 'text-editor creates a window');
// 2. disk-usage scans a real folder with node:fs and posts results to its window
const os = await import('node:os'), fs = await import('node:fs'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'du-'));
fs.mkdirSync(path.join(tmp, 'big')); fs.writeFileSync(path.join(tmp, 'big', 'a.bin'), Buffer.alloc(5000)); fs.writeFileSync(path.join(tmp, 'small.txt'), 'hi');
s = await runApp('disk-usage', { 'window.create': () => 5, 'window.postMessage': () => null }, async ({ emit, wait }) => {
  emit({ event: 'launch', payload: { path: tmp } }); await wait(300);
});
const res = s.filter(m => m.method === 'postMessage' && m.args[1]?.result).map(m => m.args[1].result)[0];
assert(res, 'disk-usage returned a result'); assert.equal(res.total, 5002); assert.equal(res.entries[0].name, 'big'); assert.equal(res.entries[0].size, 5000);
// 3. settings main: refresh + handles messages and maps them to syscalls
const calls = [];
const H = n => (...a) => { calls.push([n, ...a]); return ({ 'account.self': { id: 'user', username: 'me', displayName: 'Me', role: 'admin' }, 'desktop.getWallpaper': 'default', 'desktop.listWallpapers': [], 'system.storage': null, 'system.info': { version: '1' }, 'prefs.get': {}, 'system.hostInfo': null, 'app.list': [{ id: 'a', name: 'A', version: '1', permissions: [] }], 'assoc.get': {}, 'ui.get': { uiScale: 100 }, 'startup.get': {}, 'process.list': [], 'account.list': [], 'window.create': 9, 'ui.set': { uiScale: 125 }, 'startup.set': true, 'notify.show': true, 'account.changePassword': true, 'account.rename': {}, 'account.remove': true })[n] ?? null; };
const names = ['account.self', 'desktop.getWallpaper', 'desktop.listWallpapers', 'system.storage', 'system.info', 'prefs.get', 'system.hostInfo', 'app.list', 'assoc.get', 'ui.get', 'startup.get', 'process.list', 'account.list', 'window.create', 'ui.set', 'startup.set', 'notify.show', 'account.changePassword', 'account.rename', 'account.remove', 'prefs.set', 'assoc.set', 'app.launch', 'process.kill', 'window.postMessage', 'sysctl.call'];
const handlers = Object.fromEntries(names.map(n => [n, H(n)]));
s = await runApp('settings', handlers, async ({ emit, wait }) => {
  await wait(100); const win = id => ({ event: 'window:message', payload: { wid: 9, data: id } });
  emit(win({ ui: { uiScale: 125 } })); emit(win({ startup: { id: 'a', on: true } })); emit(win({ notifyTest: true }));
  emit(win({ changePassword: { oldPassword: 'x', newPassword: 'yyyyyyyy' } })); emit(win({ rename: { id: 'u', displayName: 'Z' } })); emit(win({ removeAccount: 'u2' }));
  emit(win({ assoc: { ext: 'pdf', appId: 'a' } })); emit(win({ launch: 'a' })); emit(win({ killPid: 3 })); emit(win({ sys: { rid: 1, action: 'volume.get', args: {} } }));
  await wait(200);
});
const used = new Set(calls.map(c => c[0]));
for (const n of ['ui.set', 'startup.set', 'notify.show', 'account.changePassword', 'account.rename', 'account.remove', 'assoc.set', 'app.launch', 'process.kill', 'sysctl.call']) assert(used.has(n), 'settings called ' + n);
assert(s.some(m => m.method === 'postMessage' && m.args[1]?.state?.net?.hostname), 'settings state includes Node network info');
console.log('proc-host tests passed');
