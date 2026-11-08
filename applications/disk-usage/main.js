// Disk Usage: a Node.js subprocess, so it walks the file system with node:fs directly (no syscall round trips).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const LIMIT_FILES = 400000, LIMIT_MS = 45000;
async function sizeOf(dir, st) { // total bytes below dir (symlinks are not followed)
  let total = 0; const stack = [dir];
  while (stack.length) {
    if (st.files > LIMIT_FILES || Date.now() - st.t0 > LIMIT_MS) { st.partial = true; break; }
    let d; try { d = await fs.promises.opendir(stack.pop()); } catch { continue; }
    try {
      for await (const e of d) {
        const p = path.join(d.path, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) { try { total += (await fs.promises.stat(p)).size; st.files++; } catch {} }
      }
    } catch {}
  }
  return total;
}
async function scan(dir) {
  const st = { files: 0, partial: false, t0: Date.now() }, entries = []; let total = 0;
  let names; try { names = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { throw new Error(e.message); }
  for (const e of names) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const size = await sizeOf(p, st); entries.push({ name: e.name, path: p, dir: true, size }); total += size; }
    else if (e.isFile()) { try { const size = (await fs.promises.stat(p)).size; entries.push({ name: e.name, path: p, dir: false, size }); total += size; } catch {} }
  }
  entries.sort((a, b) => b.size - a.size);
  return { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), entries: entries.slice(0, 200), total, partial: st.partial, count: entries.length };
}
const launched = new Promise(r => neo.on('launch', a => r(a || {})));
neo.window.create({ title: 'Disk Usage', width: 760, height: 560, minWidth: 420, minHeight: 320, content: { file: 'view.html' } }).then(async w => {
  let busy = false;
  const run = async p => {
    if (busy) return; busy = true;
    try { await w.postMessage({ scanning: p }); await w.postMessage({ result: await scan(p) }); }
    catch (e) { await w.postMessage({ error: e.message }); }
    busy = false;
  };
  w.on('message', async m => {
    if (m.scan) await run(String(m.scan));
    else if (m.reveal) neo.app.launch('org.neoos.file-manager', { path: String(m.reveal) }).catch(() => {});
  });
  const a = await launched; await run(a.path ? String(a.path).replace(/^\/([A-Za-z]:)/, '$1') : os.homedir());
});
