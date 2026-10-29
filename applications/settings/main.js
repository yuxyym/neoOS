let importQueue = Promise.resolve();
neo.window.create({ title: 'Settings', width: 820, height: 580, minWidth: 560, minHeight: 380, resizable: true, content: { file: 'view.html' } }).then(async w => {
  async function refresh() {
    const user = await neo.account.self();
    const [theme, wallpaper, wallpapers, storage, info] = await Promise.all([neo.theme.get(), neo.desktop.getWallpaper(), neo.desktop.listWallpapers(), neo.system.storage(), neo.system.info()]);
    let accounts = [], accountError = '';
    try { accounts = await neo.account.list(); } catch (e) { accountError = e.message; }
    w.postMessage({ user, theme, wallpaper, wallpapers, storage, info, accounts, accountError });
  }
  await refresh();
  w.on('message', async m => {
    try {
      if (m.theme) await neo.theme.set(m.theme);
      if (m.wallpaper) await neo.desktop.setWallpaper(m.wallpaper);
      if (m.openWallpaper) {
        const path = await neo.dialog.openFile({ accept: 'image/*', startPath: '/' });
        if (path) await neo.desktop.setWallpaper(path);
      }
      if (m.importFile) {
        const saveImport = async () => {
          const name = String(m.importFile.name || 'Imported file').replace(/[\\/\0]/g, '_');
          if (!name || name === '.' || name === '..') throw new Error('Invalid file name');
          if (m.importFile.bytes?.byteLength > 50 * 1024 * 1024) throw new Error('Files must be 50 MB or smaller.');
          const used = new Set((await neo.fs.list('/')).map(e => e.name));
          const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
          let target = name, n = 2; while (used.has(target)) target = `${stem} (${n++})${ext}`;
          await neo.fs.write(`/${target}`, m.importFile.bytes, m.importFile.type || 'application/octet-stream');
          await w.postMessage({ imported: target });
        };
        importQueue = importQueue.then(saveImport, saveImport); await importQueue;
      }
      if (m.createAccount) await neo.account.create(m.createAccount);
      if (m.lock) { await neo.system.lock(); return; }
      await refresh();
    } catch (e) { await neo.dialog.alert({ title: 'Settings error', message: `${e.code || 'ERROR'}: ${e.message}` }); }
  });
});
