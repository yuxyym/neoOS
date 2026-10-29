neo.window.create({ title: 'About neoOS', width: 560, height: 520, resizable: false, content: { file: 'view.html' } }).then(async w => {
  w.postMessage({ os: await neo.system.info(), host: await neo.system.hostInfo() });
});
