neo.window.create({ title: 'Task Manager', width: 520, height: 360, content: { file: 'view.html' } }).then(w => {
  const push = async () => w.postMessage({ procs: await neo.process.list() });
  setInterval(push, 1000); push();
  w.on('message', async m => {
    if (m.kill && await neo.dialog.confirm({ title: 'End process', message: `End process ${m.kill}? Unsaved work may be lost.` })) neo.process.kill(m.kill);
    if (m.focus) neo.process.focus(m.focus);
    if (m.minimize) neo.process.minimize(m.minimize);
  });
});
