let win, queuedPath;
async function show(path) {
  if (!path) return;
  if (!win) { queuedPath = path; return; }
  try {
    const file = await neo.fs.read(path);
    await win.setTitle(file.name);
    await win.postMessage({ name: file.name, mime: file.mime || 'application/octet-stream', content: file.content, bytes: file.bytes });
  } catch (e) { await neo.dialog.alert({ title: 'Image Viewer error', message: `${e.code || 'ERROR'}: ${e.message}` }); await win.postMessage({ error: `${e.code || 'ERROR'}: ${e.message}` }); }
}
async function choose() {
  const user = await neo.account.self();
  const path = await neo.dialog.openFile({ accept: 'image/*', startPath: '/' });
  if (path) show(path);
}
neo.on('launch', args => args?.path ? show(args.path) : choose());
neo.window.create({ title: 'Image Viewer', width: 720, height: 520, minWidth: 360, minHeight: 260, content: { file: 'view.html' } }).then(w => {
  win = w;
  if (queuedPath) show(queuedPath);
  w.on('message', m => m?.open && choose());
});
