neo.window.create({ title: 'Clock', width: 520, height: 460, minWidth: 380, minHeight: 380, content: { file: 'view.html' } }).then(w => {
  w.on('message', async m => {
    if (!m.alarm) return;
    try { await neo.notify.show({ title: m.title || 'Timer finished', message: m.message || 'Time is up.', sound: 'alarm' }); }
    catch { await neo.dialog.alert({ title: m.title || 'Timer finished', message: m.message || 'Time is up.' }); }
  });
});
