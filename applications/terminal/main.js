// Command table only: no eval, no dynamic code execution. Each Terminal process has its own working directory.
let cwd = '/', user = { username: 'user' }, win; const hist = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fs(method, ...args) { for (let i = 0; ; i++) { try { return await neo.fs[method](...args); } catch (e) { if (e.code === 'ERATE' && i < 30) { await sleep(50); continue; } throw e; } } }
const resolve = p => { const parts = (p === undefined || p === '~' ? '/' : p.startsWith('/') ? p : `${cwd}/${p.replace(/^~\//, '/')}`).split('/'), out = []; for (const s of parts) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return '/' + out.join('/'); };
const prompt = () => `${user.username}@neoos:${cwd === '/' ? '~' : '~' + cwd}$`;
const need = (a, n, usage) => { if (a.length < n) throw Object.assign(new Error(`usage: ${usage}`), { code: 'EINVAL' }); };
async function rmr(p) { let e; try { e = await fs('list', p); for (const c of e) await rmr(c.path); } catch {} await fs('remove', p); }
const cmds = {
  help: () => 'help  echo  date  clear  whoami  pwd  cd  ls [-a]  cat  mkdir  touch  rm [-r]  mv  apps  ps  kill <pid>  open <app>  theme dark|light  neofetch  history  exit',
  echo: a => a.join(' '), date: () => new Date().toString(), whoami: () => user.username, pwd: () => cwd === '/' ? '/ (home)' : cwd, clear: () => ({ clear: true }),
  history: () => hist.map((h, i) => `${String(i + 1).padStart(3)}  ${h}`).join('\n'),
  cd: async a => { const p = resolve(a[0]); await fs('list', p); cwd = p; win?.setTitle(`${user.username}@neoos: ${cwd === '/' ? '~' : cwd}`); return ''; },
  ls: async a => { const all = a.includes('-a'), t = resolve(a.find(x => !x.startsWith('-')) ?? '.'); return (await fs('list', t)).filter(e => all || !e.name.startsWith('.')).map(e => e.name + (e.type === 'directory' ? '/' : '')).join('  '); },
  cat: async a => { need(a, 1, 'cat <file>'); const f = await fs('read', resolve(a[0])); return f.content ?? new TextDecoder().decode(f.bytes || new Uint8Array()); },
  mkdir: async a => { need(a, 1, 'mkdir <dir>'); for (const d of a) await fs('mkdir', resolve(d)); return ''; },
  touch: async a => { need(a, 1, 'touch <file>'); for (const f of a) { try { await fs('read', resolve(f)); } catch { await fs('write', resolve(f), '', 'text/plain'); } } return ''; },
  rm: async a => { const r = a.includes('-r'), t = a.filter(x => !x.startsWith('-')); need(t, 1, 'rm [-r] <path>'); for (const f of t) { if (r) await rmr(resolve(f)); else await fs('remove', resolve(f)); } return ''; },
  mv: async a => { need(a, 2, 'mv <from> <to>'); await fs('move', resolve(a[0]), resolve(a[1])); return ''; },
  apps: async () => (await neo.app.list()).map(a => `${a.id}  (${a.name})`).join('\n'),
  ps: async () => (await neo.process.list()).map(p => `${p.pid}\t${p.appId}\t${p.windows} win`).join('\n'),
  kill: async a => { need(a, 1, 'kill <pid>'); await neo.process.kill(+a[0]); return 'killed ' + a[0]; },
  open: async a => { need(a, 1, 'open <app name or id>'); await neo.app.launch(a.join(' ')); return ''; },
  theme: async a => { await neo.theme.set(a[0]); return ''; },
  neofetch: async () => { const i = await neo.system.info(); return `   ◆◆◆     ${user.username}@neoos\n  ◆   ◆    ------------\n  ◆ ◆ ◆    OS: neoOS ${i.version}\n  ◆   ◆    API: ${i.api}\n   ◆◆◆     Processes: ${i.processes}\n           Theme: ${await neo.theme.get()}`; },
  exit: () => neo.app.exit(),
};
neo.account.self().then(u => { user = u; }).finally(() => neo.window.create({ title: 'Terminal', width: 680, height: 440, minWidth: 360, minHeight: 220, content: { file: 'view.html' } }).then(w => {
  win = w; w.postMessage({ prompt: prompt() });
  w.on('message', async line => {
    const text = String(line).trim(), [c, ...a] = text.split(/\s+/); let out = '', clear = false;
    if (text) hist.push(text);
    if (c) {
      try { const r = Object.hasOwn(cmds, c) ? await cmds[c](a) : `${c}: command not found`; if (r && r.clear) clear = true; else out = r || ''; }
      catch (e) { out = `${c}: ${e.code || 'ERROR'}: ${e.message}`; }
    }
    w.postMessage({ out, clear, prompt: prompt() });
  });
}));
