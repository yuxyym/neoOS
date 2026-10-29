// Window-side shim. A window frame can only talk to the process that owns it.
(() => {
  let port; const q = [], hs = [];
  window.neoWindow = { postMessage: d => (port ? port.postMessage(d) : q.push(d)), onMessage: f => hs.push(f) };
  addEventListener('message', e => {
    if (!e.data || e.data.neo !== 'hello') return;
    document.documentElement.dataset.theme = e.data.theme; port = e.ports[0];
    port.onmessage = m => (m.data && m.data.__theme ? (document.documentElement.dataset.theme = m.data.__theme) : hs.forEach(f => f(m.data)));
    q.splice(0).forEach(d => port.postMessage(d));
  });
  // Native OS feel: no browser context menu or image dragging, except inside text fields.
  addEventListener('contextmenu', e => { if (!(e.target.closest && e.target.closest('input,textarea,[contenteditable],.u-select'))) e.preventDefault(); });
  addEventListener('dragstart', e => { if (e.target.tagName === 'IMG') e.preventDefault(); });
})();
