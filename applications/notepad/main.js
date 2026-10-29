let win, filePath, queuedPath, dirty = false;
const textual = m => !!m && (m.startsWith('text/') || m === 'application/json');
const label = () => `${dirty ? '• ' : ''}${filePath?.split('/').pop() || 'Untitled'}`;
const retitle = words => win?.setTitle(`${label()}${words != null ? ` — ${words} words` : ''}`);
async function load(path) {
  if (!win) { queuedPath = path; return; }
  try {
    const file = await neo.fs.read(path); filePath = path; dirty = false;
    win.postMessage({ load: file, readOnly: !!file.bytes && !textual(file.mime) }); retitle();
  } catch (e) { await neo.dialog.alert({ title: 'Notepad error', message: `${e.code || 'ERROR'}: ${e.message}` }); win.postMessage({ error: `${e.code || 'ERROR'}: ${e.message}` }); }
}
async function freePath(dir, base, ext) {
  const used = new Set((await neo.fs.list(dir)).map(e => e.name)); let name = `${base}${ext}`, n = 2;
  while (used.has(name)) name = `${base} ${n++}${ext}`; return `${dir === '/' ? '' : dir}/${name}`;
}
neo.on('launch', args => args?.path ? load(args.path) : null);
neo.on('activate', args => args?.path ? load(args.path) : null);
neo.window.create({ title: 'Notepad', width: 700, height: 500, minWidth: 360, minHeight: 260, content: { file: 'view.html' } }).then(w => {
  win = w; w.setBeforeClose(true); if (queuedPath) load(queuedPath);
  w.on('beforeclose', async () => { if (!dirty || await neo.dialog.confirm({ title: 'Unsaved changes', message: `“${label().replace('• ', '')}” has unsaved changes. Close without saving?` })) w.close(); });
  w.on('message', async m => {
    if (m.open) { const path = await neo.dialog.openFile({ startPath: '/' }); if (path) load(path); }
    if (m.save != null) {
      try {
        if (!filePath || m.saveAs) {
          let dir = '/'; try { await neo.fs.list('/Documents'); dir = '/Documents'; } catch {}
          filePath = await freePath(dir, 'Note', '.txt');
        }
        const saved = await neo.fs.write(filePath, String(m.save), 'text/plain'); dirty = false; retitle(); w.postMessage({ saved: filePath });
      } catch (e) { await neo.dialog.alert({ title: 'Notepad save error', message: `${e.code || 'ERROR'}: ${e.message}` }); }
    }
    if (m.stats) { dirty = !!m.stats.dirty; retitle(m.stats.words); }
  });
});
