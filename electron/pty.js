'use strict';
// Real shell sessions. Preferred backend: node-pty (full pseudo-terminal). Fallback on macOS/Linux: script(1), which also allocates a pty.
const fs = require('node:fs'), os = require('node:os');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
let lib = null;
for (const name of ['@homebridge/node-pty-prebuilt-multiarch', 'node-pty']) { try { lib = require(name); break; } catch {} }
const isWin = process.platform === 'win32';
const sessions = new Map(); let nextId = 1;
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const clamp = (v, lo, hi, d) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

function pickShell() {
  if (process.env.NEOOS_SHELL) return { file: process.env.NEOOS_SHELL, args: [] };
  if (isWin) return { file: 'powershell.exe', args: ['-NoLogo'] };
  const file = [process.env.SHELL, os.userInfo().shell, '/bin/bash', '/bin/sh'].find(s => s && fs.existsSync(s));
  return { file, args: ['-l'] };
}
function create(opts, onData, onExit) {
  const cols = clamp(opts.cols, 2, 500, 80), rows = clamp(opts.rows, 1, 300, 24), cwd = opts.cwd || os.homedir();
  const { file, args } = pickShell(), id = nextId++;
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'neoOS' };
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k];
  let session, done = false;
  const finish = code => { if (done) return; done = true; sessions.delete(id); onExit(id, code); };
  if (lib) {
    const proc = lib.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
    proc.onData(d => onData(id, d)); proc.onExit(e => finish(e.exitCode));
    session = { write: d => proc.write(d), resize: (c, r) => { try { proc.resize(c, r); } catch {} }, kill: () => { try { proc.kill(); } catch {} }, backend: 'node-pty' };
  } else if (!isWin) {
    const cmd = process.platform === 'darwin' ? ['-q', '/dev/null', file, ...args] : ['-qfc', [file, ...args].map(shq).join(' '), '/dev/null'];
    const child = spawn('script', cmd, { cwd, env: { ...env, COLUMNS: String(cols), LINES: String(rows) } }), dec = new StringDecoder('utf8');
    child.stdout.on('data', d => onData(id, dec.write(d))); child.stderr.on('data', d => onData(id, d.toString('utf8')));
    child.on('error', e => { onData(id, `\r\nFailed to start the shell: ${e.message}\r\n`); finish(1); });
    child.on('exit', code => finish(code ?? 0));
    session = { write: d => child.stdin.writable && child.stdin.write(d), resize() {}, kill: () => child.kill(), backend: 'script' };
  } else {
    throw Object.assign(new Error('The terminal needs node-pty on Windows. Run "npm install" again (see ELECTRON.md).'), { code: 'ENOSYS' });
  }
  sessions.set(id, session);
  return { id, shell: require('node:path').basename(file), backend: session.backend };
}
const get = id => sessions.get(id);
module.exports = {
  create,
  write: (id, d) => get(id)?.write(d),
  resize: (id, c, r) => get(id)?.resize(clamp(c, 2, 500, 80), clamp(r, 1, 300, 24)),
  kill: id => get(id)?.kill(),
  killAll: () => [...sessions.values()].forEach(s => s.kill()),
  backend: () => (lib ? 'node-pty' : isWin ? 'none' : 'script'),
};
