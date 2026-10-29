// Local, browser-origin storage for files owned by neoOS. No host file picker or network.
const DB = 'neoos-local-vfs', STORE = 'entries';
let db;
const memory = new Map();

export function normalize(path) {
  const parts = String(path || '/').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some(p => p === '.' || p === '..' || p.includes('\0'))) throw Object.assign(new Error('Invalid path'), { code: 'EINVAL' });
  return '/' + parts.join('/');
}
const parent = p => p === '/' ? null : p.slice(0, p.lastIndexOf('/')) || '/';
const name = p => p.slice(p.lastIndexOf('/') + 1);
const mimeByExtension = fileName => ({
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', css: 'text/css', js: 'text/javascript',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint', odp: 'application/vnd.oasis.opendocument.presentation', tsv: 'text/tab-separated-values',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
})[fileName.toLowerCase().split('.').at(-1)] || 'application/octet-stream';
const typed = entry => entry?.type === 'file' ? { ...entry, mime: mimeByExtension(entry.name) } : entry;
const metadata = entry => { const { content, bytes, ...rest } = entry; const size = bytes?.byteLength ?? (content == null ? 0 : new TextEncoder().encode(content).byteLength); return { ...rest, ...(entry.type === 'file' ? { mime: mimeByExtension(entry.name), size } : {}) }; };
function req(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function init() {
  if (globalThis.indexedDB) {
    try {
      db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'path' });
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    } catch { db = null; }
  }
  if (!(await get('/'))) await put({ path: '/', name: '/', type: 'directory', updated: Date.now() });
  for (const path of ['/applications', '/bin', '/dev', '/etc', '/home', '/mnt', '/proc', '/sys', '/system', '/system/wallpapers', '/tmp', '/usr', '/var'])
    if (!(await get(path))) await put({ path, name: name(path), type: 'directory', updated: Date.now() });
  for (const [path, content] of [['/etc/os-release', 'NAME=neoOS\nVERSION=1.0.0\n'], ['/system/README.txt', 'neoOS system files are managed by the operating system.\n'], ['/var/README.txt', 'Local system logs are available in the Log Viewer app.\n']])
    if (!(await get(path))) await put({ path, name: name(path), type: 'file', mime: 'text/plain', content, readOnly: true, updated: Date.now() });
  for (const path of ['/bin/README.txt', '/dev/README.txt', '/mnt/README.txt', '/proc/README.txt', '/sys/README.txt', '/usr/README.txt'])
    if (!(await get(path))) await put({ path, name: 'README.txt', type: 'file', mime: 'text/plain', content: 'This virtual system directory is read-only in the browser edition of neoOS.\n', readOnly: true, updated: Date.now() });
  const presets = {
    '/system/wallpapers/ocean.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#071a36"/><stop offset="1" stop-color="#087e8b"/></linearGradient></defs><rect width="1600" height="900" fill="url(#b)"/><circle cx="1250" cy="210" r="100" fill="#f5d98b"/><path d="M0 620Q250 500 520 650t500 0 580 0v250H0" fill="#075985"/><path d="M0 730q300-140 600 0t1000 0v170H0" fill="#082f49"/></svg>',
    '/system/wallpapers/forest.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#152b2a"/><stop offset="1" stop-color="#66917a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#b)"/><circle cx="300" cy="180" r="95" fill="#f3d79a"/><path d="M0 900 250 250l250 650 190-520 210 520 260-710 250 710 170-430v430" fill="#143b35"/><path d="M0 760 160 420l180 480 210-570 190 570 250-420 190 420 230-550 190 550" fill="#1e5145"/></svg>',
    '/system/wallpapers/dusk.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#231942"/><stop offset=".55" stop-color="#9f4b72"/><stop offset="1" stop-color="#f7a56b"/></linearGradient></defs><rect width="1600" height="900" fill="url(#b)"/><circle cx="820" cy="430" r="150" fill="#ffdca8"/><path d="M0 680 230 540l220 150 270-230 240 210 250-170 390 180v220H0" fill="#34234f"/><path d="m0 790 330-150 320 180 300-150 260 110 390-140v260H0" fill="#211a3e"/></svg>'
  };
  for (const [path, content] of Object.entries(presets)) if (!(await get(path))) await put({ path, name: name(path), type: 'file', mime: 'image/svg+xml', content, readOnly: true, updated: Date.now() });
}
export async function seedPackage(folder, files) {
  const dir = `/applications/${folder}`;
  if (!(await get(dir))) await put({ path: dir, name: folder, type: 'directory', readOnly: true, updated: Date.now() });
  for (const [fileName, content, mime = 'text/plain'] of files)
    await put({ path: `${dir}/${fileName}`, name: fileName, type: 'file', mime, content, readOnly: true, updated: Date.now() });
}
export async function ensureHome(userId, username = userId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(userId))) throw Object.assign(new Error('Invalid account home ID'), { code: 'EINVAL' });
  const home = `/home/${userId}`;
  const existing = await get(home);
  await put({ ...(existing || {}), path: home, name: String(username), type: 'directory', updated: existing?.updated || Date.now() });
  for (const path of [`${home}/Documents`, `${home}/Pictures`]) if (!(await get(path))) await put({ path, name: name(path), type: 'directory', updated: Date.now() });
  const sample = `${home}/Pictures/neoos-sample.svg`;
  if (!(await get(sample))) await put({
    path: sample, name: 'neoos-sample.svg', type: 'file', mime: 'image/svg+xml', updated: Date.now(),
    content: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><defs><linearGradient id="g"><stop stop-color="#172554"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs><rect width="960" height="600" fill="url(#g)"/><circle cx="700" cy="170" r="90" fill="#fef3c7"/><path d="M0 480 240 250l170 170 150-140 400 320H0" fill="#0f172a"/><text x="48" y="550" fill="white" font-family="sans-serif" font-size="30">neoOS local sample image</text></svg>'
  });
}
async function get(path) {
  if (!db) return memory.get(path);
  return req(db.transaction(STORE).objectStore(STORE).get(path));
}
async function put(entry) {
  if (!db) { memory.set(entry.path, entry); return; }
  await req(db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry));
}
async function all() {
  if (!db) return [...memory.values()];
  return req(db.transaction(STORE).objectStore(STORE).getAll());
}
export async function list(path = '/') {
  path = normalize(path); const dir = await get(path);
  if (!dir || dir.type !== 'directory') throw Object.assign(new Error('Directory not found: ' + path), { code: 'ENOENT' });
  return (await all()).filter(e => parent(e.path) === path).map(metadata).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
}
export async function read(path) {
  path = normalize(path); const e = await get(path);
  if (!e || e.type !== 'file') throw Object.assign(new Error('File not found: ' + path), { code: 'ENOENT' });
  return typed(e);
}
async function requireParent(path) {
  const p = parent(path), e = p && await get(p);
  if (!e || e.type !== 'directory') throw Object.assign(new Error('Parent directory not found'), { code: 'ENOENT' });
}
export async function write(path, content, mime = 'text/plain') {
  path = normalize(path); if (path === '/') throw Object.assign(new Error('Cannot replace root'), { code: 'EINVAL' });
  if (!path.startsWith('/home/')) throw Object.assign(new Error('The system filesystem is read-only'), { code: 'EROFS' });
  await requireParent(path); const old = await get(path);
  if (old?.type === 'directory') throw Object.assign(new Error('Path is a directory'), { code: 'EISDIR' });
  const binary = content instanceof ArrayBuffer ? new Uint8Array(content) : ArrayBuffer.isView(content) ? new Uint8Array(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)) : null;
  const e = { path, name: name(path), type: 'file', mime: mimeByExtension(name(path)), ...(binary ? { bytes: binary } : { content: String(content) }), updated: Date.now() };
  await put(e); return metadata(e);
}
export async function mkdir(path) {
  path = normalize(path); if (path === '/') return get('/'); await requireParent(path);
  if (!path.startsWith('/home/')) throw Object.assign(new Error('The system filesystem is read-only'), { code: 'EROFS' });
  if (await get(path)) throw Object.assign(new Error('Path already exists'), { code: 'EEXIST' });
  const e = { path, name: name(path), type: 'directory', updated: Date.now() }; await put(e); return e;
}
export async function remove(path) {
  path = normalize(path); if (path === '/') throw Object.assign(new Error('Cannot remove root'), { code: 'EPERM' });
  if (!path.startsWith('/home/')) throw Object.assign(new Error('The system filesystem is read-only'), { code: 'EROFS' });
  const entry = await get(path); if (!entry) throw Object.assign(new Error('Path not found'), { code: 'ENOENT' });
  if (entry.type === 'directory' && (await all()).some(e => parent(e.path) === path)) throw Object.assign(new Error('Directory is not empty'), { code: 'ENOTEMPTY' });
  if (!db) memory.delete(path); else await req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(path));
}
export async function move(from, to) {
  from = normalize(from); to = normalize(to);
  if (!from.startsWith('/home/') || !to.startsWith('/home/')) throw Object.assign(new Error('System files are read-only'), { code: 'EROFS' });
  if (from === to) return get(from);
  if (to.startsWith(`${from}/`)) throw Object.assign(new Error('Cannot move a directory inside itself'), { code: 'EINVAL' });
  const entry = await get(from); if (!entry) throw Object.assign(new Error('Source not found'), { code: 'ENOENT' });
  await requireParent(to); if (await get(to)) throw Object.assign(new Error('Destination already exists'), { code: 'EEXIST' });
  const records = (await all()).filter(e => e.path === from || e.path.startsWith(`${from}/`));
  const moves = records.map(e => { const nextName = e.path === from ? name(to) : e.name; return { ...e, path: to + e.path.slice(from.length), name: nextName, mime: e.type === 'file' ? mimeByExtension(nextName) : e.mime, updated: Date.now() }; });
  for (const e of records) { if (!db) memory.delete(e.path); else await req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(e.path)); }
  for (const e of moves) await put(e);
  return metadata(moves[0]);
}
