neo.window.create({ title: 'Task Manager', width: 640, height: 460, minWidth: 420, minHeight: 280, content: { file: 'view.html' } }).then(w => {
  let tab = 'apps', busy = false;
  const push = async () => {
    if (busy) return; busy = true;
    try {
      if (tab === 'apps') await w.postMessage({ tab, procs: await neo.process.list() });
      else { const all = await neo.system.hostProcesses(); await w.postMessage({ tab, total: all.length, procs: all.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 150) }); }
    } catch (e) { await w.postMessage({ error: `${e.code || 'ERROR'}: ${e.message}` }); }
    finally { busy = false; }
  };
  setInterval(push, 2000); push();
  w.on('message', async m => {
    try {
      if (m.tab) { tab = m.tab; await push(); }
      if (m.kill && await neo.dialog.confirm({ title: 'End process', message: `End neoOS process ${m.kill}? Unsaved work may be lost.` })) await neo.process.kill(m.kill);
      if (m.killHost && await neo.dialog.confirm({ title: 'End system process', message: `Terminate process ${m.killHost} (${m.name}) on this computer? Unsaved work in that program may be lost.` })) await neo.system.killHostProcess(m.killHost);
      if (m.focus) await neo.process.focus(m.focus);
      if (m.minimize) await neo.process.minimize(m.minimize);
    } catch (e) { await neo.dialog.alert({ title: 'Task Manager error', message: `${e.code || 'ERROR'}: ${e.message}` }); }
    push();
  });
});
