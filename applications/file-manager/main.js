// File Manager process. Works on the real host file system. Keeps navigation history, clipboard and "open with" preferences; the window is a pure view.
let path = '/', hist = ['/'], hi = 0, clipboard = null, showHidden = false, win, prefs = null, places = [], startPath = null;
const join = (d, n) => `${d === '/' ? '' : d}/${n}`;
const dirname = p => p.slice(0, p.lastIndexOf('/')) || '/';
const basename = p => p.slice(p.lastIndexOf('/') + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Every fs call goes through here so a burst of operations backs off on ERATE instead of failing.
async function fs(method, ...args) {
  for (let i = 0; ; i++) {
    try { return await neo.fs[method](...args); }
    catch (e) { if (e.code === 'ERATE' && i < 30) { await sleep(50); continue; } throw e; }
  }
}
const ready = (async () => {
  const p = await neo.system.paths();
  const defs = [['Home', p.home, '⌂'], ['Desktop', p.desktop, '▭'], ['Documents', p.documents, '▤'], ['Downloads', p.downloads, '⇩'], ['Pictures', p.pictures, '▣'], ['Music', p.music, '♪'], ['Videos', p.videos, '▶'], ['Computer', '/', '▥']];
  for (const [name, target, glyph] of defs) { if (!target) continue; try { await fs('list', target); places.push({ name, path: target, glyph }); } catch {} }
  path = hist[0] = p.home;
})();
async function push(extra = {}) {
  if (!win) return;
  const entries = (await fs('list', path)).filter(e => showHidden || !e.name.startsWith('.'));
  await win.postMessage({ path, entries, places, canBack: hi > 0, canForward: hi < hist.length - 1, canPaste: !!clipboard, clipboard, showHidden, ...extra });
}
async function go(target, record = true) {
  await fs('list', target); // throws if it is not a directory
  path = target;
  if (record) { hist = hist.slice(0, hi + 1); hist.push(target); hi = hist.length - 1; }
  await push();
}
function splitName(name) { const dot = name.lastIndexOf('.'); return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']; }
async function freeName(dir, name, suffix) {
  const used = new Set((await fs('list', dir)).map(e => e.name)); if (!used.has(name)) return name;
  const [stem, ext] = splitName(name); let n = 1, candidate;
  do { candidate = `${stem}${suffix}${n > 1 ? ' ' + n : ''}${ext}`; n++; } while (used.has(candidate));
  return candidate;
}
async function searchTree(query) { // searches below the current folder
  const q = query.trim().toLowerCase(), found = [], queue = [path], t0 = Date.now(); let visited = 0;
  if (!q) return found;
  while (queue.length && visited < 20000 && Date.now() - t0 < 15000) {
    let items; try { items = await fs('list', queue.shift()); } catch { continue; }
    for (const item of items) {
      if ((!showHidden && item.name.startsWith('.')) || item.name === 'node_modules') continue;
      if (item.name.toLowerCase().includes(q)) found.push(item);
      if (item.type === 'directory') queue.push(item.path); else visited++;
      if (found.length >= 200) return found;
    }
  }
  return found;
}
async function loadPrefs() {
  if (prefs) return prefs;
  try { prefs = JSON.parse((await neo.storage.get('openwith')) || '{}'); } catch { prefs = {}; }
  return prefs;
}
async function open(entry, forceChoose = false) {
  if (entry.type === 'directory') return go(entry.path);
  const apps = await neo.app.list(), mime = entry.mime || 'application/octet-stream', ext = (entry.name.split('.').pop() || '').toLowerCase();
  const matches = app => app.associations?.some(t => (t.endsWith('/*') ? mime.startsWith(t.slice(0, -1)) : t === mime));
  const candidates = apps.filter(matches), p = await loadPrefs(), known = id => id === '@system' || apps.some(a => a.id === id);
  let appId = !forceChoose && p[ext] && known(p[ext]) ? p[ext] : !forceChoose && candidates.length === 1 ? candidates[0].id : null;
  if (!appId) {
    const list = [...(candidates.length ? candidates.map(a => ({ label: a.name, value: a.id })) : [{ label: 'Notepad (try as text)', value: 'org.neoos.notepad' }, { label: 'Image Viewer (try as image)', value: 'org.neoos.image-viewer' }]), { label: 'System default application', value: '@system' }];
    appId = await neo.dialog.choose({ title: 'Open with', message: `Choose how to open “${entry.name}”. neoOS will remember it for .${ext || 'this'} files.`, options: list });
    if (!appId) return;
    if (ext) { p[ext] = appId; try { await neo.storage.set('openwith', JSON.stringify(p)); } catch {} }
  }
  if (appId === '@system') await neo.system.openPath(entry.path); else await neo.app.launch(appId, { path: entry.path });
}
async function reveal(target) { // show that folder (or the folder of a file)
  try { await go(target); }
  catch { try { await go(dirname(target)); await push({ select: target }); } catch {} }
}
neo.on('launch', a => { if (a?.path) { if (win) reveal(a.path); else startPath = a.path; } });
neo.on('activate', a => { if (a?.path) reveal(a.path); });
ready.then(() => neo.window.create({ title: 'Files', width: 900, height: 580, minWidth: 520, minHeight: 340, content: { file: 'view.html' } })).then(async w => {
  win = w; if (startPath) await reveal(startPath); else await go(path, false).catch(() => go('/', false));
  w.on('message', async m => {
    try {
      const entry = m.path && { path: m.path, name: basename(m.path), type: m.type, mime: m.mime };
      switch (m.action) {
        case 'go': await go(m.path); break;
        case 'back': if (hi > 0) { hi--; await go(hist[hi], false); } break;
        case 'forward': if (hi < hist.length - 1) { hi++; await go(hist[hi], false); } break;
        case 'up': if (path !== '/') await go(dirname(path)); break;
        case 'refresh': await push(); break;
        case 'toggle-hidden': showHidden = !showHidden; await push(); break;
        case 'open': await open(entry); break;
        case 'open-with': await open(entry, true); break;
        case 'goto': await reveal(m.path); break;
        case 'terminal': await neo.app.launch('org.neoos.terminal', { cwd: m.path || path }); break;
        case 'copy': case 'cut': clipboard = { path: m.path, type: m.type, name: basename(m.path), move: m.action === 'cut' }; await push(); break;
        case 'paste': {
          if (!clipboard) break;
          const name = await freeName(path, clipboard.name, clipboard.move ? ' moved' : ' copy'), dst = join(path, name);
          if (clipboard.move) { if (dirname(clipboard.path) !== path) await fs('move', clipboard.path, dst); clipboard = null; }
          else await fs('copy', clipboard.path, dst);
          await push({ select: dst }); break;
        }
        case 'new-file': { const name = await freeName(path, 'Untitled.txt', ''), p = join(path, name); await fs('write', p, '', 'text/plain'); await push({ select: p, rename: true }); break; }
        case 'new-folder': { const name = await freeName(path, 'New Folder', ''), p = join(path, name); await fs('mkdir', p); await push({ select: p, rename: true }); break; }
        case 'rename': {
          const name = String(m.name || '').trim().replace(/[\\/\0]/g, '_');
          if (!name || name === '.' || name === '..' || name === basename(m.path)) { await push(); break; }
          const target = join(dirname(m.path), name); await fs('move', m.path, target); await push({ select: target }); break;
        }
        case 'delete': {
          const label = basename(m.path);
          if (await neo.dialog.confirm({ title: 'Move to Trash', message: `Move “${label}”${m.type === 'directory' ? ' and everything inside it' : ''} to the Trash?` })) {
            try { await fs('remove', m.path); }
            catch (e) {
              if (e.code !== 'ETRASH') throw e;
              if (await neo.dialog.confirm({ title: 'Delete permanently', message: `${e.message}\n\nDelete “${label}” permanently? This cannot be undone.` })) await fs('remove', m.path, { permanent: true });
            }
            if (clipboard?.path === m.path) clipboard = null;
          }
          await push(); break;
        }
        case 'search': await win.postMessage({ search: m.query, entries: await searchTree(String(m.query || '')) }); break;
      }
    } catch (e) { await neo.dialog.alert({ title: 'File Manager error', message: `${e.code || 'ERROR'}: ${e.message}` }); await win.postMessage({ error: `${e.code || 'ERROR'}: ${e.message}` }).catch(() => {}); await push().catch(() => {}); }
  });
});
