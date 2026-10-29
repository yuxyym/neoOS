# neoOS
A JavaScript desktop OS that runs in your browser (GPL-3.0). No build step.

## Run
Serve this folder with any static server (`python3 -m http.server`) and open it. Copy `branding/` and `resources/{fonts,sounds}` from the original repo (not included here; the OS degrades gracefully without them).

## Architecture
- `os/kernel.js` owns manifests, PIDs, permissions, and the API bridge. `os/wm.js` owns visible window chrome. `os/shell.js` renders the launcher and taskbar.
- Each app is a metadata-only `manifest.json` plus JavaScript `main` entry. The kernel runs `main` in a hidden opaque-origin sandbox. Apps decide whether and when to create windows with `neo.window.create`; the OS never auto-creates an app window.
- A process may own any number of windows, including none. `neo.app.exit()`, process kill, and `exitWhenLastWindowCloses` control its lifetime.
- Files and settings stay local to this browser profile. The signed-in user's files appear at `/`; system files and other accounts are hidden from apps. File Manager imports files through Settings and stores their bytes inside neoOS IndexedDB; the import does not leave a host-file link.
- Built-in apps: About, Calculator, Calendar, Clock, File Manager, Image Viewer, Log Viewer, Notepad, Paint, local File Search, Settings, System Monitor, Terminal, and Task Manager.
- Local sign-in supports multiple browser-profile accounts, admin account creation, account-specific Home folders, a lock screen, and per-account theme/wallpaper settings.
- App exceptions and unhandled promise errors appear in a neoOS alert and are recorded in the local system log; app code does not need to inspect the browser console.
- `sdk/` contains the public client SDK; `neoui/neoui.css` provides design tokens, components, and themes.
- Start with [the Hello World tutorial](docs/hello-world.md), [the API reference](docs/api.md), and [the Phase 1 architecture](docs/phase-1-architecture.md). Check the remaining roadmap in `ROADMAP.md`.
- Read [the system model](docs/system-model.md) for the current kernel boundaries and browser-hosted limitations.
# Office apps and dock

Documents, Spreadsheets, and Presentations embed the complete third-party Office editor at `edit.chaxus.com`. The editor runs in its own cross-origin window. neoOS supplies file bytes from its file manager and saves returned edits into the account's virtual filesystem. Internet access is required to load the editor; document bytes are processed by that browser editor. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and licensing.

The bottom dock keeps per-account pinned applications. Use the `+` control to add an installed app, click a pin to launch or focus it, and use its remove control to unpin it.
