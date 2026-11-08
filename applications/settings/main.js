// Settings runs as a Node.js subprocess, so it can use Node directly (os.networkInterfaces below) next to the neo API.
const os = require('node:os');
let importQueue = Promise.resolve();
function netInfo() {
  const interfaces = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const a of list || []) interfaces.push({ name, family: String(a.family).replace(/^4$/, 'IPv4').replace(/^6$/, 'IPv6'), address: a.address, mac: a.mac, internal: !!a.internal });
  return { hostname: os.hostname(), interfaces };
}
neo.window.create({ title: 'System Settings', width: 960, height: 680, minWidth: 720, minHeight: 460, resizable: true, content: { file: 'view.html' } }).then(async w => {
  const fail = e => w.postMessage({ fail: `${e.code || 'ERROR'}: ${e.message}` }).catch(() => {});
  async function refresh() {
    const user = await neo.account.self();
    const [wallpaper, wallpapers, storage, info, prefs, hostInfo, apps, assoc, ui, startup, procs] = await Promise.all([
      neo.desktop.getWallpaper(), neo.desktop.listWallpapers(), neo.system.storage(), neo.system.info(), neo.prefs.get(), neo.system.hostInfo().catch(() => null),
      neo.app.list(), neo.assoc.get().catch(() => ({})), neo.ui.get(), neo.startup.get().catch(() => ({})), neo.process.list().catch(() => [])]);
    let accounts = [], accountError = '';
    try { accounts = await neo.account.list(); } catch (e) { accountError = e.message; }
    w.postMessage({ state: { user, wallpaper, wallpapers, storage, info, accounts, accountError, prefs, hostInfo, assoc, ui, startup, procs, net: netInfo(),
      apps: apps.map(a => ({ id: a.id, name: a.name, version: a.version, description: a.description, permissions: a.permissions || [], associations: a.associations || [] })) } });
  }
  await refresh();
  w.on('message', async m => {
    if (m.sys) { // pass-through to the host system layer
      try { w.postMessage({ sysr: { rid: m.sys.rid, ok: true, result: await neo.sysctl.call(m.sys.action, m.sys.args) } }); }
      catch (e) { w.postMessage({ sysr: { rid: m.sys.rid, ok: false, error: e.message } }); }
      return;
    }
    try {
      if (m.prefs) { w.postMessage({ prefs: await neo.prefs.set(m.prefs) }); return; }
      if (m.ui) { w.postMessage({ ui: await neo.ui.set(m.ui) }); return; }
      if (m.startup) { await neo.startup.set(m.startup.id, !!m.startup.on); w.postMessage({ startup: await neo.startup.get() }); return; }
      if (m.notifyTest) { await neo.notify.show({ title: 'Test notification', message: 'Notifications are working.', sound: 'message', force: true }); w.postMessage({ done: 'Notification sent' }); return; }
      if (m.power) {
        if (m.power === 'lock') { await neo.system.lock(); return; }
        const t = { restart: ['Restart computer', 'Your computer will restart now. Unsaved work will be lost.'], shutdown: ['Shut down computer', 'Your computer will shut down now. Unsaved work will be lost.'], quit: ['Quit neoOS', 'neoOS will close. Unsaved work may be lost.'] }[m.power];
        if (m.power === 'sleep') await neo.sysctl.call('power.sleep');
        else if (t && await neo.dialog.confirm({ title: t[0], message: t[1] })) { m.power === 'quit' ? await neo.power.shutdown() : await neo.sysctl.call('power.' + m.power); }
        return;
      }
      if (m.launch) { await neo.app.launch(String(m.launch)); await refresh(); return; }
      if (m.killPid) { await neo.process.kill(+m.killPid); await refresh(); return; }
      if (m.changePassword) { await neo.account.changePassword(m.changePassword); w.postMessage({ done: 'Password changed' }); return; }
      if (m.rename) { await neo.account.rename(m.rename); await refresh(); w.postMessage({ done: 'Name updated' }); return; }
      if (m.removeAccount) { await neo.account.remove({ id: m.removeAccount }); await refresh(); w.postMessage({ done: 'Account removed' }); return; }
      if (m.assoc) await neo.assoc.set(m.assoc.ext, m.assoc.appId);
      if (m.wallpaper) await neo.desktop.setWallpaper(m.wallpaper);
      if (m.openWallpaper) { const path = await neo.dialog.openFile({ accept: 'image/*' }); if (path) await neo.desktop.setWallpaper(path); }
      if (m.importFile) {
        const saveImport = async () => {
          const name = String(m.importFile.name || 'Imported file').replace(/[\\/\0]/g, '_');
          if (!name || name === '.' || name === '..') throw new Error('Invalid file name');
          if (m.importFile.bytes?.byteLength > 50 * 1024 * 1024) throw new Error('Files must be 50 MB or smaller.');
          const dest = (await neo.system.paths()).downloads, used = new Set((await neo.fs.list(dest)).map(e => e.name));
          const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
          let target = name, n = 2; while (used.has(target)) target = `${stem} (${n++})${ext}`;
          await neo.fs.write(`${dest}/${target}`, m.importFile.bytes, m.importFile.type || 'application/octet-stream');
          await w.postMessage({ imported: target });
        };
        importQueue = importQueue.then(saveImport, saveImport); await importQueue;
      }
      if (m.createAccount) { await neo.account.create(m.createAccount); w.postMessage({ done: 'Account created' }); }
      if (m.refresh || m.assoc || m.wallpaper || m.openWallpaper || m.createAccount) await refresh();
    } catch (e) { await fail(e); }
  });
});
