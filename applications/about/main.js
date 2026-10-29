neo.window.create({ title: 'About neoOS', width: 560, height: 360, resizable: false, content: { file: 'view.html' } }).then(async w => {
  w.postMessage(await neo.system.info());
});
