neo.window.create({ title: 'System Monitor', width: 920, height: 640, minWidth: 560, minHeight: 380, content: { file: 'view.html' } }).then(w => {
  let busy = false, tick = 0, info = null, procs = [];
  const refresh = async () => {
    if (busy) return; busy = true;
    try {
      info ??= await neo.system.hostInfo();
      const [apps, stats, storage] = await Promise.all([neo.process.list(), neo.system.hostStats(), neo.system.storage()]);
      if (tick++ % 2 === 0) procs = await neo.system.hostProcesses().catch(() => procs);
      const top = procs.slice().sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 40);
      w.postMessage({ apps, stats, storage, info, procs: top, total: procs.length });
    } catch (e) { w.postMessage({ error: `${e.code || 'ERROR'}: ${e.message}` }); }
    finally { busy = false; }
  };
  refresh(); setInterval(refresh, 2000);
  w.on('message', async m => {
    try {
      if (m.focus) await neo.process.focus(m.focus);
      if (m.minimize) await neo.process.minimize(m.minimize);
      if (m.kill && await neo.dialog.confirm({ title: 'End process', message: `End neoOS process ${m.kill}? Unsaved work may be lost.` })) await neo.process.kill(m.kill);
    } catch (e) { await neo.dialog.alert({ title: 'System Monitor error', message: e.message }); }
    refresh();
  });
});
