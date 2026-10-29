export function alert({ title = 'Error', message = 'An unexpected error occurred.' } = {}) {
  return new Promise(resolve => {
    const shade = document.createElement('div');
    Object.assign(shade.style, { position: 'fixed', inset: '0', zIndex: '41000', display: 'grid', placeItems: 'center', background: 'rgb(0 0 0 / .68)', color: 'var(--neo-text)', font: '14px var(--neo-font-sans)' });
    const box = document.createElement('section');
    Object.assign(box.style, { width: 'min(440px, 90vw)', padding: '20px', border: '1px solid var(--neo-border)', borderRadius: '12px', background: 'var(--neo-surface-1)', boxShadow: 'var(--neo-shadow-2)' });
    box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'neo-alert-title');
    const heading = document.createElement('h2'); heading.id = 'neo-alert-title'; heading.textContent = String(title); heading.style.margin = '0 0 12px';
    const body = document.createElement('p'); body.textContent = String(message); body.style.whiteSpace = 'pre-wrap'; body.style.overflowWrap = 'anywhere';
    const close = document.createElement('button'); close.className = 'neo-btn neo-btn--primary'; close.textContent = 'OK'; close.style.display = 'block'; close.style.marginInlineStart = 'auto';
    box.append(heading, body, close); shade.append(box); document.body.append(shade);
    const done = () => { shade.remove(); document.removeEventListener('keydown', onKey); resolve(); };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') done(); };
    document.addEventListener('keydown', onKey); close.onclick = done; close.focus();
  });
}

export function confirm({ title = 'Confirm action', message = 'Continue?' } = {}) {
  return new Promise(resolve => {
    const shade = document.createElement('div');
    Object.assign(shade.style, { position: 'fixed', inset: '0', zIndex: '41000', display: 'grid', placeItems: 'center', background: 'rgb(0 0 0 / .68)', color: 'var(--neo-text)', font: '14px var(--neo-font-sans)' });
    const box = document.createElement('section');
    Object.assign(box.style, { width: 'min(440px, 90vw)', padding: '20px', border: '1px solid var(--neo-border)', borderRadius: '12px', background: 'var(--neo-surface-1)', boxShadow: 'var(--neo-shadow-2)' });
    box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2'); heading.textContent = String(title); heading.style.margin = '0 0 12px';
    const body = document.createElement('p'); body.textContent = String(message); body.style.whiteSpace = 'pre-wrap'; body.style.overflowWrap = 'anywhere';
    const actions = document.createElement('div'); Object.assign(actions.style, { display: 'flex', justifyContent: 'end', gap: '8px', marginTop: '20px' });
    const cancel = document.createElement('button'); cancel.className = 'neo-btn'; cancel.textContent = 'Cancel';
    const okay = document.createElement('button'); okay.className = 'neo-btn neo-btn--danger'; okay.textContent = 'Continue';
    actions.append(cancel, okay); box.append(heading, body, actions); shade.append(box); document.body.append(shade);
    const done = value => { shade.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
    document.addEventListener('keydown', onKey); cancel.onclick = () => done(false); okay.onclick = () => done(true); cancel.focus();
  });
}

export function choose({ title = 'Open with', message = 'Choose an application', options = [] } = {}) {
  return new Promise(resolve => {
    const shade = document.createElement('div');
    Object.assign(shade.style, { position: 'fixed', inset: '0', zIndex: '41000', display: 'grid', placeItems: 'center', background: 'rgb(0 0 0 / .68)', color: 'var(--neo-text)', font: '14px var(--neo-font-sans)' });
    const box = document.createElement('section');
    Object.assign(box.style, { width: 'min(440px, 90vw)', padding: '20px', border: '1px solid var(--neo-border)', borderRadius: '12px', background: 'var(--neo-surface-1)', boxShadow: 'var(--neo-shadow-2)' });
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2'); heading.textContent = String(title); heading.style.margin = '0 0 8px';
    const body = document.createElement('p'); body.textContent = String(message); body.style.margin = '0 0 16px';
    const actions = document.createElement('div'); Object.assign(actions.style, { display: 'grid', gap: '8px' });
    const done = value => { shade.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = e => { if (e.key === 'Escape') done(null); };
    for (const option of options) { const button = document.createElement('button'); button.className = 'neo-btn'; button.textContent = option.label; button.onclick = () => done(option.value); actions.append(button); }
    const cancel = document.createElement('button'); cancel.className = 'neo-btn neo-btn--ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => done(null); actions.append(cancel);
    box.append(heading, body, actions); shade.append(box); document.body.append(shade); document.addEventListener('keydown', onKey); actions.querySelector('button')?.focus();
  });
}
