# neoOS system model

neoOS is a local-first desktop environment running inside a browser tab. It has a kernel-like trusted core and separate app sandboxes, but it is not a bootable operating system and does not control hardware or the browser's scheduler.

## Current system boundaries

- `os/kernel.js` owns app registration, PIDs, manifest permissions, syscalls, session identity, and the app-to-kernel message bridge.
- `os/wm.js` owns windows. The shell bar, launcher groups, desktop surface, and theme tokens are separate modules.
- `os/vfs.js` stores a virtual Unix-style tree in IndexedDB. Each signed-in account sees its own home as `/`; the backing `/home/<account>` path is private kernel implementation detail. Apps cannot list or read operating-system files or another account's home. Package files and OS internals are outside the user namespace.
- Files are classified from their current filename extension. Renaming `picture.svg` to `picture` removes its image association; unknown types prompt for an app. Imported binary files are copied as byte arrays into IndexedDB. User-created text remains UTF-8 text.
- `os/accounts.js` provides local browser-profile accounts, a sign-in/lock screen, and salted PBKDF2 password verifiers. The first account is the local admin. This is an application account boundary, not protection from someone who controls the browser profile or developer tools.
- Each app process runs in a hidden opaque-origin sandboxed iframe; each visible app window is another sandboxed iframe. The kernel loads app entry and window HTML. Apps receive only declared syscall capabilities and cannot open host popups or access the shell DOM.
- The message bridge is the syscall boundary. This browser edition has no preemptive scheduling, CPU quotas, hardware syscalls, service restart manager, app signing, or hardened production CSP.

## System applications

The built-in suite includes About, Calculator, Calendar, Clock, File Manager, Image Viewer, Log Viewer, Notepad, Paint, Search, Settings, System Monitor, Terminal, and Task Manager. File Manager sees the signed-in user's files as `/`, supports copy, move, rename, delete, hidden-file toggling, and search. Settings manages theme, wallpaper, local accounts, and storage; its import action copies the selected file's bytes into the VFS. File MIME associations follow the current extension; unknown types prompt for an app.

## Remaining OS work

See [ROADMAP.md](../ROADMAP.md) for deferred subsystems, including durable logs, richer package/module loading, account recovery and elevation, background services, a real shell, export to the host, and further security hardening.
