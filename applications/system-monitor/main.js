neo.window.create({ title: 'System Monitor', width: 760, height: 520, minWidth: 480, minHeight: 320, content: { file: 'view.html' } }).then(w => {
  let busy = false;
  const refresh = async () => {
    if (busy) return; busy = true;
    try { w.postMessage({ processes: await neo.process.list(), storage: await neo.system.storage(), info: await neo.system.info() }); }
    finally { busy = false; }
  };
  refresh(); const timer = setInterval(refresh, 2000);
  w.on('close', () => clearInterval(timer));
  w.on('message', async m => {
    if (m.focus) await neo.process.focus(m.focus);
    if (m.minimize) await neo.process.minimize(m.minimize);
    if (m.kill && await neo.dialog.confirm({ title: 'End process', message: `End process ${m.kill}? Unsaved work may be lost.` })) await neo.process.kill(m.kill);
    refresh();
  });
});
