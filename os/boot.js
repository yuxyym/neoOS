// Boot: start kernel, then sign-in, then shell, then autostart apps.
import { init, registry, launch, log } from './kernel.js';
import { initShell } from './shell.js';
import { alert as showAlert } from './dialogs.js';
import { authenticate } from './accounts.js';
import { setCurrentUser, lockSession } from './kernel.js';
const fadeLoader = () => { const l = document.getElementById('loader'); if (!l) return; l.classList.add('is-done'); setTimeout(() => l.remove(), 450); };
try {
  await init();
  const user = await authenticate(); await setCurrentUser(user);
  initShell({ user, onLock: lockSession }); fadeLoader();
  for (const a of registry.values()) if (a.manifest.autostart) launch(a.manifest.id).catch(e => { log('error', 'boot', e.message); showAlert({ title: 'Unable to start app', message: e.message }); });
} catch (e) {
  log('error', 'boot', e.stack || e.message);
  document.getElementById('loader')?.remove();
  await showAlert({ title: 'neoOS startup error', message: e.message });
}
