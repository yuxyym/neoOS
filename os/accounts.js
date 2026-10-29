import * as vfs from './vfs.js';
import { playSound } from './sound.js';

const KEY = 'neoos.accounts.v1';
const users = () => { try { const data = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } };
const save = list => localStorage.setItem(KEY, JSON.stringify(list));
const publicUser = u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role });
async function digest(password, salt) {
  if (!crypto?.subtle) throw Object.assign(new Error('Password hashing is unavailable in this browser context.'), { code: 'ENOTSUP' });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(n => n.toString(16).padStart(2, '0')).join('');
}
const saltText = bytes => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
const saltBytes = s => new Uint8Array(s.match(/.{2}/g).map(x => parseInt(x, 16)));
export function listAccounts() { return users().map(publicUser); }
export async function createAccount({ username, displayName, password }) {
  username = String(username || '').trim().toLowerCase(); displayName = String(displayName || username).trim();
  if (!/^[a-z0-9_-]{3,24}$/.test(username)) throw Object.assign(new Error('Username must be 3–24 characters using letters, numbers, _ or -.'), { code: 'EINVAL' });
  if (String(password || '').length < 8) throw Object.assign(new Error('Password must be at least 8 characters.'), { code: 'EINVAL' });
  const list = users(); if (list.some(u => u.username === username)) throw Object.assign(new Error('That username already exists.'), { code: 'EEXIST' });
  const salt = new Uint8Array(16); crypto.getRandomValues(salt);
  const randomId = crypto.randomUUID ? crypto.randomUUID() : saltText(crypto.getRandomValues(new Uint8Array(16)));
  const user = { id: list.length ? `u-${randomId}` : 'user', username, displayName, role: list.length ? 'user' : 'admin', salt: saltText(salt), hash: await digest(password, salt) };
  list.push(user); save(list); await vfs.ensureHome(user.id, username); return publicUser(user);
}
export async function signIn(username, password) {
  const user = users().find(u => u.username === String(username || '').trim().toLowerCase());
  if (!user || await digest(String(password || ''), saltBytes(user.salt)) !== user.hash)
    throw Object.assign(new Error('The username or password is incorrect.'), { code: 'EACCES' });
  await vfs.ensureHome(user.id, user.username); return publicUser(user);
}

const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const make = (tag, cls = '', text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// Lock / sign-in screen. Account creation is only offered while no account exists; after that an admin adds users in Settings.
export async function authenticate() {
  return new Promise(resolve => {
    const root = make('main', 'neo-lock'); root.setAttribute('aria-label', 'Sign in to neoOS');
    const time = make('div', 'neo-lock__time'), date = make('div', 'neo-lock__date'), head = make('div'); head.append(time, date);
    const panel = make('section', 'neo-lock__panel'), brand = make('footer', 'neo-lock__brand');
    const logo = new Image(18, 18); logo.src = 'branding/neoiconwhite.png'; logo.alt = ''; brand.append(logo, make('span', '', 'neoOS'));
    root.append(head, panel, brand); document.body.append(root);
    const tick = () => { const d = new Date(); time.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); date.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); };
    tick(); const timer = setInterval(tick, 1000);
    const list = users(); let selected = list.length === 1 ? list[0] : null;
    const field = (type, placeholder, auto) => { const i = make('input', 'neo-input'); i.type = type; i.placeholder = placeholder; i.autocomplete = auto; i.required = true; i.setAttribute('aria-label', placeholder); return i; };
    const avatar = u => { const a = make('span', 'neo-avatar', (u.displayName || u.username)[0]); a.style.background = `hsl(${hue(u.username)} 52% 46%)`; return a; };
    const finish = user => { clearInterval(timer); root.remove(); playSound('service-login'); resolve(user); };
    function render() {
      panel.replaceChildren();
      const creating = !list.length;
      if (!creating && list.length > 1) {
        const row = make('div', 'neo-lock__users');
        for (const u of list) { const b = make('button', 'neo-lock__user' + (selected?.id === u.id ? ' is-selected' : '')); b.type = 'button'; b.append(avatar(u), make('span', '', u.displayName || u.username)); b.onclick = () => { selected = u; render(); }; row.append(b); }
        panel.append(row);
      }
      if (!creating && !selected) { panel.append(make('p', '', 'Choose an account to sign in.')); return; }
      const form = make('form', 'neo-lock__form'), error = make('div', 'neo-lock__error'); error.setAttribute('role', 'alert');
      let nameEl, userEl; const passEl = field('password', creating ? 'Choose a password (8+ characters)' : 'Password', creating ? 'new-password' : 'current-password');
      if (creating) {
        form.append(make('h1', '', 'Welcome to neoOS'), make('p', '', 'Create the first account. It becomes the administrator.'));
        nameEl = field('text', 'Your name', 'name'); userEl = field('text', 'Username', 'username'); form.append(nameEl, userEl);
      } else {
        const who = make('div'); if (list.length === 1) who.append(avatar(selected)); who.style.display = 'grid'; who.style.placeItems = 'center'; who.style.gap = '8px';
        who.append(make('h1', '', selected.displayName || selected.username)); form.append(who);
      }
      const submit = make('button', 'neo-btn neo-btn--primary', creating ? 'Create account' : 'Sign in'); submit.type = 'submit';
      form.append(passEl, error, submit); panel.append(form);
      form.onsubmit = async e => {
        e.preventDefault(); submit.disabled = true; error.textContent = '';
        try { finish(creating ? await createAccount({ username: userEl.value, displayName: nameEl.value, password: passEl.value }) : await signIn(selected.username, passEl.value)); }
        catch (err) { error.textContent = err.message; passEl.value = ''; passEl.focus(); form.classList.remove('is-error'); void form.offsetWidth; form.classList.add('is-error'); submit.disabled = false; }
      };
      (nameEl || passEl).focus();
    }
    render();
  });
}
