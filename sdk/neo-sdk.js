// neo SDK (classic script, zero deps). The kernel inlines this into every process frame before `main`.
(() => {
  let port, n = 0, ready; const pend = new Map(), hs = {}, wins = new Map();
  const rdy = new Promise(r => (ready = r));
  class NeoError extends Error { constructor(e) { super(e.message); this.name = 'NeoError'; this.code = e.code; } }
  const call = (api, method, ...args) => rdy.then(() => new Promise((res, rej) => { const id = ++n; pend.set(id, { res, rej }); port.postMessage({ id, api, method, args, v: 1 }); }));
  const report = (title, value) => {
    const message = String(value && (value.stack || value.message) || value || 'Unknown error').slice(0, 1200);
    call('log', 'write', 'error', message).catch(() => {});
    call('dialog', 'alert', { title, message }).catch(() => {});
  };
  const fire = (e, p) => (hs[e] || []).forEach(f => { try { f(p); } catch (x) { report('App event error', x); } });
  addEventListener('message', e => {
    if (!e.data || e.data.neo !== 'hello' || !e.ports[0]) return;
    port = e.ports[0]; neo.pid = e.data.pid; neo.manifest = e.data.manifest; neo.currentTheme = e.data.theme;
    port.onmessage = m => {
      const d = m.data;
      if (d.event) {
        if (d.event === 'theme:changed') neo.currentTheme = d.payload;
        const w = d.payload && wins.get(d.payload.wid);
        if (d.event === 'window:message' && w) w.emit('message', d.payload.data);
        else if (d.event === 'window:beforeclose' && w) w.emit('beforeclose');
        else if (d.event === 'window:close' && w) { wins.delete(w.id); w.emit('close'); }
        else fire(d.event, d.payload);
        return;
      }
      const p = pend.get(d.id); if (!p) return; pend.delete(d.id); d.ok ? p.res(d.result) : p.rej(new NeoError(d.error));
    };
    ready();
  });
  addEventListener('error', e => { e.preventDefault(); report('App error', e.error || e.message); });
  addEventListener('unhandledrejection', e => { e.preventDefault(); report('App promise error', e.reason); });
  class Win {
    constructor(id) { this.id = id; this.h = {}; wins.set(id, this); }
    on(e, f) { (this.h[e] ||= []).push(f); return () => { this.h[e] = this.h[e].filter(x => x !== f); }; }
    emit(e, d) { (this.h[e] || []).forEach(f => f(d)); }
    postMessage(d) { return call('window', 'postMessage', this.id, d); }
  }
  for (const m of ['setTitle', 'resize', 'move', 'close', 'focus', 'minimize', 'maximize', 'setAlwaysOnTop', 'setBeforeClose'])
    Win.prototype[m] = function (...a) { return call('window', m, this.id, ...a); };
  const base = {
    NeoError, call,
    on(e, f) { (hs[e] ||= []).push(f); return () => { hs[e] = hs[e].filter(x => x !== f); }; },
    window: { create: async o => new Win(await call('window', 'create', o)) },
  };
  const ns = a => new Proxy({}, { get: (_, m) => (...args) => call(a, m, ...args) }); // generic: neo.<api>.<method>(...)
  const neo = new Proxy(base, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k !== 'then' ? ns(k) : undefined), set: (t, k, v) => ((t[k] = v), true) });
  window.neo = neo;
})();
