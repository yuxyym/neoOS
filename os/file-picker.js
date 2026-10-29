import * as vfs from './vfs.js';

// System-owned chooser. It renders from the neoOS VFS and never exposes a host file input.
export function openFilePicker({ accept = '*/*', startPath, homePath = '/home/user' } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '40000', display: 'grid', placeItems: 'center', background: 'rgb(0 0 0 / .65)', color: 'var(--neo-text)', font: '14px var(--neo-font-sans)' });
    const panel = document.createElement('section');
    Object.assign(panel.style, { width: 'min(620px, 92vw)', height: 'min(500px, 82vh)', display: 'flex', flexDirection: 'column', padding: '16px', border: '1px solid var(--neo-border)', borderRadius: '12px', background: 'var(--neo-surface-1)', boxShadow: 'var(--neo-shadow-2)' });
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Choose a file from neoOS');
    const header = document.createElement('h2'); header.textContent = 'Choose a file'; header.style.margin = '0 0 8px';
    const location = document.createElement('div'); location.className = 'u-muted'; location.style.marginBottom = '8px';
    const list = document.createElement('div'); Object.assign(list.style, { flex: '1', overflow: 'auto', border: '1px solid var(--neo-border)', borderRadius: '8px', padding: '4px' });
    const footer = document.createElement('div'); Object.assign(footer.style, { display: 'flex', justifyContent: 'space-between', paddingTop: '12px' });
    const hint = document.createElement('span'); hint.className = 'u-muted'; hint.textContent = 'Files stay inside neoOS storage.';
    const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px';
    const cancel = document.createElement('button'); cancel.className = 'neo-btn'; cancel.textContent = 'Cancel';
    const open = document.createElement('button'); open.className = 'neo-btn neo-btn--primary'; open.textContent = 'Open'; open.disabled = true;
    actions.append(cancel, open); footer.append(hint, actions); panel.append(header, location, list, footer); overlay.append(panel); document.body.append(overlay);
    let current = vfs.normalize(startPath || `${homePath}/Pictures`), selected = null, done = false;
    if (current !== homePath && !current.startsWith(`${homePath}/`)) current = `${homePath}/Pictures`;
    const finish = value => { if (done) return; done = true; overlay.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = e => { if (e.key === 'Escape') finish(null); if (e.key === 'Enter' && selected) finish(selected.path); };
    document.addEventListener('keydown', onKey);
    cancel.onclick = () => finish(null); overlay.onclick = e => { if (e.target === overlay) finish(null); };
    open.onclick = () => selected && finish(selected.path);
    const matches = entry => accept === '*/*' || accept.split(',').some(rule => {
      rule = rule.trim().toLowerCase(); const ext = entry.name.toLowerCase().split('.').pop();
      if (rule === 'image/*') return ['png','jpg','jpeg','gif','webp','svg','bmp','avif'].includes(ext);
      return rule.startsWith('.') ? entry.name.toLowerCase().endsWith(rule) : entry.mime === rule;
    });
    const button = (label, action) => { const b = document.createElement('button'); b.className = 'neo-btn neo-btn--ghost'; b.style.display = 'block'; b.style.width = '100%'; b.style.textAlign = 'left'; b.textContent = label; b.onclick = action; return b; };
    async function render() {
      selected = null; open.disabled = true; location.textContent = current; list.replaceChildren();
      if (current !== homePath) list.append(button('↰  Parent folder', () => { current = current.slice(0, current.lastIndexOf('/')) || homePath; if (current !== homePath && !current.startsWith(`${homePath}/`)) current = homePath; render(); }));
      let entries; try { entries = await vfs.list(current); } catch { entries = []; }
      for (const entry of entries) {
        if (entry.type === 'file' && !matches(entry)) continue;
        const row = button(`${entry.type === 'directory' ? '📁' : '▧'}  ${entry.name}`, () => {
          if (entry.type === 'directory') { current = entry.path; render(); return; }
          selected = entry; open.disabled = false;
          [...list.querySelectorAll('button')].forEach(b => b.classList.remove('is-active'));
          row.classList.add('is-active');
        });
        row.ondblclick = () => { if (entry.type === 'file') finish(entry.path); };
        list.append(row);
      }
      if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'u-muted'; empty.textContent = 'This folder has no matching files.'; list.append(empty); }
    }
    render(); cancel.focus();
  });
}
