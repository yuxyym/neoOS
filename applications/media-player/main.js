// Media Player: streams the file through a native Chromium view (no copying into memory), so large videos work.
const toUrl = p => 'file://' + p.split('/').map((s, i) => (i === 1 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/');
const EXT = /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|mp4|m4v|webm|mkv|mov|ogv)$/i;
const dirOf = p => p.slice(0, p.lastIndexOf('/')) || '/';
const launched = new Promise(r => neo.on('launch', a => r(a || {})));
neo.window.create({ title: 'Media Player', width: 900, height: 620, minWidth: 420, minHeight: 300, content: { file: 'view.html' } }).then(async w => {
  let vid = null, files = [], idx = -1;
  async function play(path) {
    try {
      const url = toUrl(path);
      if (vid == null) vid = await neo.browser.open({ wid: w.id, top: 44, url }); else await neo.browser.navigate(vid, url);
      const dir = dirOf(path);
      files = (await neo.fs.list(dir)).filter(e => e.type === 'file' && EXT.test(e.name)).map(e => e.path);
      idx = Math.max(0, files.indexOf(path)); if (!files.length) files = [path];
      await w.setTitle(path.slice(path.lastIndexOf('/') + 1) + ' - Media Player');
      await w.postMessage({ files: files.map(f => ({ path: f, name: f.slice(f.lastIndexOf('/') + 1) })), index: idx });
    } catch (e) { await neo.dialog.alert({ title: 'Media Player error', message: `${e.code || 'ERROR'}: ${e.message}` }); }
  }
  w.on('message', async m => {
    if (m.open) { const p = await neo.dialog.openFile({ accept: 'audio/*,video/*,.mp3,.wav,.ogg,.flac,.m4a,.mp4,.webm,.mkv,.mov' }); if (p) await play(p); }
    else if (m.step && files.length) await play(files[(idx + m.step + files.length) % files.length]);
    else if (typeof m.pick === 'number' && files[m.pick]) await play(files[m.pick]);
  });
  const a = await launched; if (a.path) await play(a.path);
});
