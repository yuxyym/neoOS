// Real terminal: bridges an xterm.js window to a shell on a host pseudo-terminal via the kernel's pty.* syscalls.
let win, id = null, buf = '', timer = null, started = false;
const launched = new Promise(r => neo.on('launch', a => r(a || {})));
const flush = () => { clearTimeout(timer); timer = null; if (!buf || !win) return; const data = buf; buf = ''; win.postMessage({ data }).catch(() => {}); };
neo.on('pty:data', ({ data }) => { buf += data; if (buf.length > 32768) flush(); else if (!timer) timer = setTimeout(flush, 10); }); // batch output to stay under the call rate limit
neo.on('pty:exit', () => { flush(); win?.close(); });
neo.window.create({ title: 'Terminal', width: 820, height: 520, minWidth: 360, minHeight: 220, content: { file: 'view.html' } }).then(w => {
  win = w;
  w.on('message', async m => {
    try {
      if (m.ready && !started) { started = true; const a = await launched; const r = await neo.pty.spawn({ cols: m.cols, rows: m.rows, cwd: a.cwd }); id = r.id; w.setTitle(`Terminal — ${r.shell}`); }
      else if (id != null && m.input != null) await neo.pty.write(id, m.input);
      else if (id != null && m.resize) await neo.pty.resize(id, m.resize.cols, m.resize.rows);
    } catch (e) { w.postMessage({ data: `\r\n\x1b[31m${e.code || 'ERROR'}: ${e.message}\x1b[0m\r\n` }); }
  });
});
