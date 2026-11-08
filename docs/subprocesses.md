# App subprocesses and app discovery

## Apps are folders
Every folder inside `applications/` that contains a `manifest.json` is an app. There is no index file any more
(`os/apps.index.json` is unused and can be deleted). The desktop rescans every 5 seconds, so a new folder shows up in the
launcher without a restart. Apps are only added during a session, never removed.

## Apps are Node.js processes
`electron/procs.js` starts each app's `main` in its own Electron utility process (a real Node.js process) running
`electron/proc-host.js`, which defines the global `neo` SDK and then `require()`s the app's `main` file.
Inside `main` you can use the whole Node API next to `neo`:

```js
const os = require('node:os');           // e.g. Settings > Network and Disk Usage do this
neo.window.create({ title: 'Hi', content: { html: `<p>${os.hostname()}</p>` } });
```

Window HTML (`view.html`) is still sandboxed in the desktop; only `main` runs in Node.
Message path: app process <-> main process <-> kernel (renderer, `os/kernel.js`), which keeps the syscall table and checks
manifest permissions for `neo.*` calls. **Node APIs themselves are not permission-checked**, so only install apps you trust.
Closing the last window (or `neo.app.exit()`, Task Manager "End") kills the subprocess; a crashed process is cleaned up automatically.

## Services
A "service" is just an app with no window: set `"autostart": true` (or switch it on under Settings > Startup Apps) and
`"exitWhenLastWindowCloses": false`.

## New APIs
`neo.app.rescan()`, `neo.ui.get/set` (interface scale, auto-lock, Do Not Disturb), `neo.startup.get/set(id, on)`,
`neo.account.changePassword/rename/remove`, `neo.notify.show({force:true})`.

## Tests
`node tools/tests/proc-host.test.mjs` runs the real app mains against a fake kernel.
`node tools/tests/accounts.test.mjs` tests account management (run inside the project so `os/` resolves).
