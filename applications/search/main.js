const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fs(method, ...args) { // back off on rate limiting instead of failing a long crawl
  for (let i = 0; ; i++) { try { return await neo.fs[method](...args); } catch (e) { if (e.code === 'ERATE' && i < 30) { await sleep(50); continue; } throw e; } }
}
async function search(query, home) {
  const q = String(query).trim().toLowerCase(); if (!q) return [];
  const found = [], todo = [home]; let visited = 0;
  while (todo.length && visited < 500) {
    const dir = todo.shift(); let items; try { items = await fs('list', dir); } catch { continue; }
    for (const item of items) {
      if (item.type === 'directory') { todo.push(item.path); if (item.name.toLowerCase().includes(q)) found.push({ path: item.path, name: item.name, type: 'directory' }); continue; }
      visited++;
      let match = item.name.toLowerCase().includes(q);
      if (!match && item.mime?.startsWith('text/')) {
        try { const file = await fs('read', item.path), content = file.content ?? new TextDecoder().decode(file.bytes || new Uint8Array()); match = content.toLowerCase().includes(q); } catch {}
      }
      if (match) found.push({ path: item.path, name: item.name, mime: item.mime, type: 'file' });
      if (found.length >= 100) return found;
    }
  }
  return found;
}
neo.account.self().then(() => neo.window.create({ title: 'Search', width: 580, height: 440, minWidth: 360, minHeight: 280, content: { file: 'view.html' } }).then(w => {
  w.on('message', async m => {
    if (m.query != null) { try { w.postMessage({ results: await search(m.query, '/') }); } catch (e) { await neo.dialog.alert({ title: 'Search error', message: e.message }); w.postMessage({ error: e.message }); } }
    if (m.path) {
      const dir = m.path.slice(0, m.path.lastIndexOf('/')) || '/';
      if (m.type === 'directory') neo.app.launch('org.neoos.file-manager', { path: m.path });
      else if (m.mime?.startsWith('image/')) neo.app.launch('org.neoos.image-viewer', { path: m.path });
      else if (m.mime?.startsWith('text/')) neo.app.launch('org.neoos.notepad', { path: m.path });
      else neo.app.launch('org.neoos.file-manager', { path: m.path });
    }
  });
}));
