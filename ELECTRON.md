# neoOS as an Electron app

neoOS now runs as a full-screen desktop application with the **real** file system, a **real** shell and live system information.

## Install and run
```bash
unzip -o neoos-electron.zip -d /path/to/your/neoOS     # extract over the existing project
cd /path/to/your/neoOS
node tools/apply-electron-patch.mjs                     # one-time edit of the remaining files (all-or-nothing)
npm install                                             # Electron + native terminal backend
npm start                                               # F11 toggles full screen; the user menu has "Quit neoOS"
```
Linux "SUID sandbox" error: run `npm run start:nosandbox`, or fix permissions on `node_modules/electron/dist/chrome-sandbox`.
Build installers with `npm run dist` (electron-builder).

## Look
neoOS has one built-in, non-customisable look in the style of Windows 8 (flat, square, accent blue, Start-screen tiles, taskbar). It lives in `neoui/retro.css` (name kept for compatibility). All text/background pairs meet WCAG AA contrast (4.5:1).

## What is real now
| App | Uses |
|---|---|
| File Manager | The whole computer (`/`, or drives on Windows), real copy/move/rename, Trash on delete, "System default application", "Open terminal here" |
| Terminal | Your login shell (bash/zsh/PowerShell…) on a real pseudo-terminal via xterm.js. Backend: node-pty, or `script(1)` on macOS/Linux if node-pty is missing |
| System Monitor | Live CPU (per core), memory, disk, uptime, load, and the busiest host processes |
| Task Manager | neoOS apps plus every process on the computer, with End |
| About / Settings | Real hostname, OS, CPU, RAM, Electron/Chromium/Node; real disk usage |
| Notepad, Image Viewer, Paint, Search, Office apps, file picker | Real files (Documents, Pictures, Downloads, home) |
| Calendar, Open-with choices | Per-app storage (`neo.storage`) instead of dotfiles in your home |

## New / changed API (see `os/kernel.js`)
`neo.system.paths()`, `hostInfo()`, `hostStats()`, `hostProcesses()`, `killHostProcess(pid)`, `openPath(path)`; `neo.fs.copy(from,to)`; `neo.fs.remove(path,{permanent})` (Trash by default);
`neo.storage.get/set/remove`; `neo.pty.spawn/write/resize/kill` with `pty:data` / `pty:exit` events.
New manifest permissions: `host.info`, `host.processes`, `host.kill`, `host.open`, `pty`. The existing `fs.read:~/*` / `fs.write:~/*` now mean the whole host file system.

## Security notes
The renderer is sandboxed (`contextIsolation`, `sandbox`, no Node). Only the kernel page can call the host bridge (sender checked in the main process), and apps only reach it through manifest permissions. Terminal, process-kill and full-disk scopes are powerful: only install apps you trust.
Browser-only mode is gone: `neoOS` needs the Electron shell. Accounts and settings are stored in the app's Chromium profile (`neoos://app` origin), not in a normal browser.
The office editors still need internet access (they load `edit.chaxus.com`).
