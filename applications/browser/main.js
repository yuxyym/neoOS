// Browser process. The page itself is a native Chromium view owned by the host (see os/kernel.js "browser.*"),
// so sites load exactly as in a normal browser: no iframe, X-Frame-Options or CORS restrictions.
const START = 'https://duckduckgo.com/';
const HOST = /^(localhost|(\d{1,3}\.){3}\d{1,3}|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i;
function toUrl(input) {
  const s = String(input || '').trim(); if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && HOST.test(s)) return (/^(localhost|\d)/i.test(s) ? 'http://' : 'https://') + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}
neo.window.create({ title: 'Browser', width: 1100, height: 720, minWidth: 480, minHeight: 320, content: { file: 'view.html' } }).then(async w => {
  let id = null;
  neo.on('browser:state', s => { w.setTitle(s.title ? s.title + ' - Browser' : 'Browser'); w.postMessage(s); });
  w.on('message', async m => {
    if (id == null) return;
    try {
      if (m.go) { const u = toUrl(m.go); if (u) await neo.browser.navigate(id, u); }
      else if (m.action) await neo.browser.action(id, m.action);
    } catch (e) { await neo.dialog.alert({ title: 'Browser error', message: (e.code || 'ERROR') + ': ' + e.message }); }
  });
  try { id = await neo.browser.open({ wid: w.id, top: 44, url: START }); }
  catch (e) { await neo.dialog.alert({ title: 'Browser unavailable', message: e.message }); }
});
