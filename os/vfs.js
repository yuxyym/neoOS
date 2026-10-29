// neoOS file system layer. Backed by the real host file system through the Electron bridge.
// Paths are absolute host paths in POSIX form ("/home/me/x"; on Windows "/C:/Users/me/x", and "/" lists the drives).
import * as host from './host.js';

export function normalize(path) {
  const raw = String(path || '/').replace(/\\/g, '/'), parts = raw.split('/').filter(Boolean);
  if (parts.some(p => p === '.' || p === '..' || p.includes('\0'))) throw Object.assign(new Error('Invalid path'), { code: 'EINVAL' });
  return '/' + parts.join('/');
}
const TEXT = 'txt log ini cfg conf env sh bash zsh bat ps1 py rb go rs java kt c h cpp hpp cs ts tsx jsx vue lua php sql yml yaml toml xml rst tex gitignore'.split(' ');
const MIME = {
  md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', ods: 'application/vnd.oasis.opendocument.spreadsheet', tsv: 'text/tab-separated-values',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint', odp: 'application/vnd.oasis.opendocument.presentation',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', zip: 'application/zip',
};
export const mimeByExtension = name => { const ext = String(name).toLowerCase().split('.').at(-1); return MIME[ext] || (TEXT.includes(ext) ? 'text/plain' : 'application/octet-stream'); };
const isText = m => m.startsWith('text/') || m === 'application/json' || m === 'image/svg+xml';
const withMime = e => (e.type === 'file' ? { ...e, mime: mimeByExtension(e.name) } : e);

export async function init() { if (!host.available) throw Object.assign(new Error('neoOS must run inside its Electron shell. Start it with "npm start".'), { code: 'ENOSYS' }); }
export const seedPackage = async () => {};   // kept for API compatibility: app packages are real files now
export const ensureHome = async () => {};    // accounts no longer own a virtual home

export async function list(path = '/') {
  const entries = (await host.call('fs:list', normalize(path))).map(withMime);
  return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'directory' ? -1 : 1));
}
export async function read(path) {
  const r = await host.call('fs:read', normalize(path)), mime = mimeByExtension(r.name);
  const base = { path: r.path, name: r.name, type: 'file', mime, size: r.size, updated: r.updated };
  return isText(mime) ? { ...base, content: new TextDecoder().decode(r.bytes) } : { ...base, bytes: r.bytes };
}
export async function write(path, content) {
  const data = content instanceof ArrayBuffer ? new Uint8Array(content)
    : ArrayBuffer.isView(content) ? new Uint8Array(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)) : String(content);
  return withMime(await host.call('fs:write', normalize(path), data));
}
export const mkdir = async path => host.call('fs:mkdir', normalize(path));
export const remove = (path, opts) => host.call('fs:remove', normalize(path), opts);
export const move = async (from, to) => withMime(await host.call('fs:move', normalize(from), normalize(to)));
export const copy = async (from, to) => withMime(await host.call('fs:copy', normalize(from), normalize(to)));

// Built-in wallpapers (virtual; selected as "preset:<name>").
export const presets = {
  ocean: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#071a36"/><stop offset="1" stop-color="#087e8b"/></linearGradient></defs><rect width="1600" height="900" fill="url(#b)"/><circle cx="1250" cy="210" r="100" fill="#f5d98b"/><path d="M0 620Q250 500 520 650t500 0 580 0v250H0" fill="#075985"/><path d="M0 730q300-140 600 0t1000 0v170H0" fill="#082f49"/></svg>',
  forest: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#152b2a"/><stop offset="1" stop-color="#66917a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#b)"/><circle cx="300" cy="180" r="95" fill="#f3d79a"/><path d="M0 900 250 250l250 650 190-520 210 520 260-710 250 710 170-430v430" fill="#143b35"/><path d="M0 760 160 420l180 480 210-570 190 570 250-420 190 420 230-550 190 550" fill="#1e5145"/></svg>',
  dusk: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#231942"/><stop offset=".55" stop-color="#9f4b72"/><stop offset="1" stop-color="#f7a56b"/></linearGradient></defs><rect width="1600" height="900" fill="url(#b)"/><circle cx="820" cy="430" r="150" fill="#ffdca8"/><path d="M0 680 230 540l220 150 270-230 240 210 250-170 390 180v220H0" fill="#34234f"/><path d="m0 790 330-150 320 180 300-150 260 110 390-140v260H0" fill="#211a3e"/></svg>',
};
