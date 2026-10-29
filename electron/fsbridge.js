'use strict';
// Host filesystem bridge. Public paths are POSIX-style absolute paths ("/home/me/x"; on Windows "/C:/Users/me/x", and "/" lists drives).
const fs = require('node:fs'), fsp = fs.promises, os = require('node:os'), path = require('node:path');
const isWin = process.platform === 'win32';
const MAX_READ = 128 * 1024 * 1024;
const err = (code, message) => Object.assign(new Error(message), { code });

function toHost(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('\0') || p.split('/').includes('..')) throw err('EINVAL', 'Invalid path');
  if (!isWin) return path.posix.normalize(p);
  const rest = p.slice(1);
  if (!rest) throw err('EINVAL', 'The computer root is not a folder on this platform');
  return /^[A-Za-z]:\/?$/.test(rest) ? rest.slice(0, 2) + '\\' : rest.replace(/\//g, '\\');
}
const toPub = h => (isWin ? '/' + h.replace(/\\/g, '/').replace(/\/+$/, '') : h);
const pj = (dir, name) => (dir === '/' ? '' : dir.replace(/\/+$/, '')) + '/' + name;
const exists = async h => { try { await fsp.lstat(h); return true; } catch { return false; } };
const meta = (pub, st) => ({ path: pub, name: pub.slice(pub.lastIndexOf('/') + 1) || pub, type: st.isDirectory() ? 'directory' : 'file', size: st.isFile() ? st.size : 0, updated: st.mtimeMs });

function create({ trash }) {
  return {
    async list(p) {
      if (isWin && p === '/') {
        const out = [];
        for (let c = 65; c <= 90; c++) { const d = String.fromCharCode(c) + ':'; try { await fsp.access(d + '\\'); out.push({ path: '/' + d, name: d, type: 'directory', size: 0, updated: Date.now() }); } catch {} }
        return out;
      }
      const h = toHost(p), dirents = await fsp.readdir(h, { withFileTypes: true }), out = [];
      for (let i = 0; i < dirents.length; i += 64) {
        await Promise.all(dirents.slice(i, i + 64).map(async d => {
          try { const st = await fsp.stat(path.join(h, d.name)); if (st.isDirectory() || st.isFile()) out.push(meta(pj(p, d.name), st)); } catch {}
        }));
      }
      return out;
    },
    async read(p) {
      const h = toHost(p), st = await fsp.stat(h);
      if (st.isDirectory()) throw err('EISDIR', 'Path is a directory');
      if (st.size > MAX_READ) throw err('ELIMIT', 'File is too large to open here (limit 128 MB)');
      return { ...meta(p, st), bytes: await fsp.readFile(h) };
    },
    async write(p, data) {
      const h = toHost(p), buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      await fsp.writeFile(h, buf); return meta(p, await fsp.stat(h));
    },
    async mkdir(p) { const h = toHost(p); await fsp.mkdir(h); return meta(p, await fsp.stat(h)); },
    async remove(p, opts) {
      const h = toHost(p);
      if (p === '/' || h === path.parse(h).root || h === os.homedir()) throw err('EPERM', 'Refusing to delete this folder');
      await fsp.lstat(h);
      if (opts && opts.permanent) return void (await fsp.rm(h, { recursive: true }));
      try { await trash(h); } catch (e) { throw err('ETRASH', 'Could not move the item to the Trash: ' + e.message); }
    },
    async move(from, to) {
      const a = toHost(from), b = toHost(to);
      if (a === b) return meta(to, await fsp.stat(b));
      if (b.startsWith(a + path.sep)) throw err('EINVAL', 'Cannot move a folder inside itself');
      if (await exists(b)) throw err('EEXIST', 'Destination already exists');
      try { await fsp.rename(a, b); }
      catch (e) { if (e.code !== 'EXDEV') throw e; await fsp.cp(a, b, { recursive: true, errorOnExist: true, force: false }); await fsp.rm(a, { recursive: true }); }
      return meta(to, await fsp.stat(b));
    },
    async copy(from, to) {
      const a = toHost(from), b = toHost(to);
      if (b === a || b.startsWith(a + path.sep)) throw err('EINVAL', 'A folder cannot be copied into itself');
      if (await exists(b)) throw err('EEXIST', 'Destination already exists');
      await fsp.cp(a, b, { recursive: true, errorOnExist: true, force: false });
      return meta(to, await fsp.stat(b));
    },
  };
}
module.exports = { create, toHost, toPub, isWin };
