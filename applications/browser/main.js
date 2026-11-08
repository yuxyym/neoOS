// Browser process: real tabs, each a native Chromium view owned by the host (see os/kernel.js "browser.*" and os/extras.js).
const START = 'https://duckduckgo.com/', TOP = 76; // TOP = height of the tab strip (34) + toolbar (42) in view.html
const HOST = /^(localhost|(\d{1,3}\.){3}\d{1,3}|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i;
function toUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^file:\/\//i.test(s)) return s;
  if (/^(?:https?:|about:|data:)/i.test(s)) return s;
  if (/^\.?\.?[\\/]/.test(s) || /\.(?:html?|xhtml|svg)$/i.test(s) || s.includes('\\') || s.includes('/')) {
    const normalized = s.replace(/\\/g, '/');
    const filePath = /^[A-Za-z]:\//.test(normalized) ? normalized : normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `file://${filePath.replace(/ /g, '%20')}`;
  }
  if (!/\s/.test(s) && HOST.test(s)) return (/^(localhost|\d)/i.test(s) ? 'http://' : 'https://') + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}
neo.window.create({ title: 'Browser', width: 1100, height: 720, minWidth: 480, minHeight: 320, content: { file: 'view.html' } }).then(async w => {
  let tabs = [], active = null, busy = Promise.resolve(); const pending = new Map();
  const view = () => ({ tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, canBack: t.canBack, canForward: t.canForward })), active });
  const push = () => { const t = tabs.find(x => x.id === active); w.setTitle(t && t.title ? t.title + ' - Browser' : 'Browser'); return w.postMessage(view()); };
  const fail = e => neo.dialog.alert({ title: 'Browser error', message: (e.code || 'ERROR') + ': ' + e.message });
  async function activate(id) { active = id; await Promise.all(tabs.map(t => neo.browser.setActive(t.id, t.id === id))); push(); }
  async function addTab(url) {
    const id = await neo.browser.open({ wid: w.id, top: TOP, url: url || START });
    tabs.push({ id, title: '', url: url || START, loading: true, canBack: false, canForward: false, ...(pending.get(id) || {}) }); pending.delete(id);
    await activate(id);
  }
  async function closeTab(id) {
    const i = tabs.findIndex(t => t.id === id); if (i < 0) return;
    await neo.browser.close(id); tabs.splice(i, 1);
    if (!tabs.length) { w.close(); return; }
    if (active === id) await activate(tabs[Math.min(i, tabs.length - 1)].id); else push();
  }
  neo.on('browser:state', s => { const t = tabs.find(x => x.id === s.id); if (!t) { pending.set(s.id, s); return; } Object.assign(t, s); push(); });
  w.on('message', m => { busy = busy.then(async () => {
    try {
      const t = tabs.find(x => x.id === active);
      if (m.go && t) { const u = toUrl(m.go); if (u) await neo.browser.navigate(t.id, u); }
      else if (m.action && t) await neo.browser.action(t.id, m.action);
      else if (m.newTab) await addTab();
      else if (m.switch && tabs.some(x => x.id === m.switch)) await activate(m.switch);
      else if (m.close) await closeTab(m.close);
    } catch (e) { await fail(e); }
  }); });
  try { await addTab(); } catch (e) { await fail(e); }
});
