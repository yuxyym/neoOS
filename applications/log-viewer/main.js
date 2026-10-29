neo.window.create({ title: 'Log Viewer', width: 820, height: 520, minWidth: 480, minHeight: 320, content: { file: 'view.html' } }).then(w => {
  let busy = false;
  const refresh = async () => { if (busy) return; busy = true; try { w.postMessage({ entries: await neo.log.read(300) }); } finally { busy = false; } };
  refresh(); const timer = setInterval(refresh, 1500); w.on('close', () => clearInterval(timer));
  w.on('message', m => { if (m.refresh) refresh(); });
});
