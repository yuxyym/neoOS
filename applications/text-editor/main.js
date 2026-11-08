// Text Editor process: file I/O for the editor window (tabs live in the window).
const MAX = 8 * 1024 * 1024;
let win = null, dirty = 0; const queue = [];
const send = m => (win ? win.postMessage(m) : queue.push(m));
async function loadFile(path) {
  try {
    const f = await neo.fs.read(path);
    if ((f.size || 0) > MAX) throw new Error('This file is larger than 8 MB.');
    let text = f.content;
    if (text == null) {
      const bytes = f.bytes ? new Uint8Array(f.bytes) : new Uint8Array();
      if (bytes.subarray(0, 8000).includes(0)) throw new Error('This looks like a binary file.');
      text = new TextDecoder().decode(bytes);
    }
    await send({ loaded: { path, name: path.slice(path.lastIndexOf('/') + 1), text } });
  } catch (e) { await send({ error: `${e.code || 'ERROR'}: ${e.message}` }); }
}
neo.on('launch', a => a && a.path && loadFile(a.path));
neo.on('activate', a => { if (a && a.path) loadFile(a.path); if (win) win.focus(); });
neo.window.create({ title: 'Text Editor', width: 900, height: 620, minWidth: 420, minHeight: 280, content: { file: 'view.html' } }).then(async w => {
  win = w; await w.setBeforeClose(true);
  const p = await neo.system.paths();
  await w.postMessage({ init: { home: p.home, documents: p.documents || p.home } });
  queue.splice(0).forEach(m => w.postMessage(m));
  w.on('beforeclose', async () => {
    if (!dirty || await neo.dialog.confirm({ title: 'Unsaved changes', message: `${dirty} file${dirty > 1 ? 's have' : ' has'} unsaved changes. Close without saving?` })) w.close();
  });
  w.on('message', async m => {
    try {
      if (m.dirty != null) dirty = m.dirty;
      if (m.open) { const path = await neo.dialog.openFile({}); if (path) await loadFile(path); }
      if (m.save) {
        const s = m.save; await neo.fs.write(s.path, s.content, 'text/plain');
        await w.postMessage({ saved: { id: s.id, path: s.path, name: s.path.slice(s.path.lastIndexOf('/') + 1) } });
      }
    } catch (e) { await w.postMessage({ error: `${e.code || 'ERROR'}: ${e.message}` }); }
  });
});
