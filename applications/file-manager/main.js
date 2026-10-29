// File Manager process. Keeps navigation history, clipboard and "open with" preferences; the window is a pure view.
let path = '/', hist = ['/'], hi = 0, clipboard = null, showHidden = false, win, prefs = null;
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
async function push(extra = {}) {
  if (!win) return;
  const entries = (await fs('list', path)).filter(e => showHidden || !e.name.startsWith('.'));
  await win.postMessage({ path, entries, canBack: hi > 0, canForward: hi < hist.length - 1, canPaste: !!clipboard, clipboard, showHidden, ...extra });
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
async function copyTree(src, dst, type) {
  if (type === 'directory') {
    if (dst === src || dst.startsWith(src + '/')) throw Object.assign(new Error('A folder cannot be copied into itself.'), { code: 'EINVAL' });
    await fs('mkdir', dst);
    for (const e of await fs('list', src)) await copyTree(e.path, join(dst, e.name), e.type);
  } else { const f = await fs('read', src); await fs('write', dst, f.bytes || f.content || '', f.mime); }
}
async function removeTree(p, type) {
  if (type === 'directory') for (const e of await fs('list', p)) await removeTree(e.path, e.type);
  await fs('remove', p);
}
async function searchTree(query) {
  const q = query.trim().toLowerCase(), found = [], queue = ['/']; let visited = 0;
  if (!q) return found;
  while (queue.length && visited < 1500) {
    let items; try { items = await fs('list', queue.shift()); } catch { continue; }
    for (const item of items) {
      if (!showHidden && item.name.startsWith('.')) continue;
      if (item.name.toLowerCase().includes(q)) found.push(item);
      if (item.type === 'directory') queue.push(item.path); else visited++;
      if (found.length >= 200) return found;
    }
  }
  return found;
}
async function loadPrefs() {
  if (prefs) return prefs;
  try { prefs = JSON.parse((await fs('read', '/.openwith.json')).content || '{}'); } catch { prefs = {}; }
  return prefs;
}
async function open(entry, forceChoose = false) {
  if (entry.type === 'directory') return go(entry.path);
  const apps = await neo.app.list(), mime = entry.mime || 'application/octet-stream', ext = (entry.name.split('.').pop() || '').toLowerCase();
  const matches = app => app.associations?.some(t => (t.endsWith('/*') ? mime.startsWith(t.slice(0, -1)) : t === mime));
  const candidates = apps.filter(matches), p = await loadPrefs();
  let appId = !forceChoose && p[ext] && apps.some(a => a.id === p[ext]) ? p[ext] : !forceChoose && candidates.length === 1 ? candidates[0].id : null;
  if (!appId) {
    const list = candidates.length ? candidates : [{ name: 'Notepad (try as text)', id: 'org.neoos.notepad' }, { name: 'Image Viewer (try as image)', id: 'org.neoos.image-viewer' }];
    appId = await neo.dialog.choose({ title: 'Open with', message: candidates.length ? `Choose an application for “${entry.name}”. neoOS will remember it for .${ext} files.` : `neoOS doesn't know the type of “${entry.name}”. Choose how to try opening it.`, options: list.map(a => ({ label: a.name, value: a.id })) });
    if (!appId) return;
    if (ext) { p[ext] = appId; try { await fs('write', '/.openwith.json', JSON.stringify(p), 'application/json'); } catch {} }
  }
  await neo.app.launch(appId, { path: entry.path });
}
async function reveal(target) { // launch/activate with a path: show that folder (or the folder of a file)
  try { await go(target); }
  catch { try { await go(dirname(target)); await push({ select: target }); } catch {} }
}
neo.on('launch', a => { if (a?.path) { if (win) reveal(a.path); else path = hist[0] = a.path; } });
neo.on('activate', a => { if (a?.path) reveal(a.path); });
neo.window.create({ title: 'Files', width: 860, height: 560, minWidth: 520, minHeight: 340, content: { file: 'view.html' } }).then(async w => {
  win = w; await go(path, false).catch(() => go('/', false));
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
        case 'copy': case 'cut': clipboard = { path: m.path, type: m.type, name: basename(m.path), move: m.action === 'cut' }; await push(); break;
        case 'paste': {
          if (!clipboard) break;
          const name = await freeName(path, clipboard.name, clipboard.move ? ' moved' : ' copy'), dst = join(path, name);
          if (clipboard.move) { if (dirname(clipboard.path) !== path) await fs('move', clipboard.path, dst); clipboard = null; }
          else await copyTree(clipboard.path, dst, clipboard.type);
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
          if (await neo.dialog.confirm({ title: 'Delete item', message: `Delete “${basename(m.path)}”${m.type === 'directory' ? ' and everything inside it' : ''}? This cannot be undone.` })) { await removeTree(m.path, m.type); if (clipboard?.path === m.path) clipboard = null; }
          await push(); break;
        }
        case 'search': await win.postMessage({ search: m.query, entries: await searchTree(String(m.query || '')) }); break;
      }
    } catch (e) { await neo.dialog.alert({ title: 'File Manager error', message: `${e.code || 'ERROR'}: ${e.message}` }); await win.postMessage({ error: `${e.code || 'ERROR'}: ${e.message}` }).catch(() => {}); await push().catch(() => {}); }
  });
});
