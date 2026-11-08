// PDF Viewer: the document is shown by a native Chromium view (built-in PDF viewer: zoom, search, print, thumbnails).
const toUrl = p => 'file://' + p.split('/').map((s, i) => (i === 1 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/');
const launched = new Promise(r => neo.on('launch', a => r(a || {})));
neo.window.create({ title: 'PDF Viewer', width: 980, height: 740, minWidth: 480, minHeight: 360, content: { file: 'view.html' } }).then(async w => {
  let vid = null, current = null;
  const open = async path => {
    try {
      const url = toUrl(path), name = path.slice(path.lastIndexOf('/') + 1);
      if (vid == null) vid = await neo.browser.open({ wid: w.id, top: 40, url }); else await neo.browser.navigate(vid, url);
      current = path; await w.setTitle(name + ' - PDF Viewer'); await w.postMessage({ path, name });
    } catch (e) { await neo.dialog.alert({ title: 'PDF Viewer error', message: `${e.code || 'ERROR'}: ${e.message}` }); }
  };
  w.on('message', async m => {
    if (m.open) { const p = await neo.dialog.openFile({ accept: '.pdf' }); if (p) await open(p); }
    else if (m.external && current) { try { await neo.system.openPath(current); } catch (e) { await neo.dialog.alert({ title: 'PDF Viewer error', message: e.message }); } }
  });
  neo.on('activate', a => a && a.path && open(a.path));
  const a = await launched; if (a.path) await open(a.path);
});
