# neoOS API v1.0

## Process and window model

An app is metadata plus a JavaScript process entry point. The manifest never describes a window or HTML entry point. Launching an app starts `main` in an isolated hidden iframe with `sandbox="allow-scripts"` and an opaque origin. The kernel fetches `main.js` and package HTML itself, then inlines the source into the sandbox; the app does not load code through the opaque origin. `main` may create zero, one, or many visible windows, and a process may remain alive with no windows.

Each visible window is a separate sandboxed frame owned by its creating PID. Its `content` is `{file: "view.html"}` (a package-relative HTML file loaded by the kernel) or `{html: "<h1>Hi</h1>"}`. Window frames talk only to their owning process through `neoWindow` and the process SDK. App data lives in the local neoOS VFS (IndexedDB). Each account sees its own files as `/`; the kernel hides backing account and system paths.

## Manifest

The supported fields are `id`, `name`, `version`, `description`, `icon`, `main`, `minApiVersion`, `categories`, `permissions`, `network`, `instance`, `autostart`, `associations`, `intents`, `contributes`, and `exitWhenLastWindowCloses`. Unknown fields are rejected at registry load. `main` is a package-relative JavaScript file. Window titles, size, position, resizability, and other behavior belong in app code.

```json
{
  "id": "com.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "A small example app",
  "icon": "icon.svg",
  "main": "main.js",
  "minApiVersion": "1.0",
  "categories": ["Utilities"],
  "permissions": [],
  "network": [],
  "instance": "multi",
  "autostart": false,
  "exitWhenLastWindowCloses": true,
  "associations": [],
  "intents": [],
  "contributes": {}
}
```

`exitWhenLastWindowCloses` defaults to `true`; background apps set it to `false`. `instance` is `single` or `multi`.

## Protocol and errors

The kernel issues a private `MessageChannel` to each process. Requests use `{id, api, method, args, v}`, responses use `{id, ok, result}` or `{id, ok:false, error:{code,message}}`, and events use `{event,payload}`. The channel identifies the caller; apps cannot claim another PID. Calls are validated, permission-checked, rate-limited, and logged. `NeoError` exposes `code` and `message`. Current codes include `ENOENT`, `EACCES`, `EPERM`, `EINVAL`, `ERATE`, and `ENOSYS`.

## Namespaces

| Namespace | Available calls |
|---|---|
| `neo.window` | `create(options)`; returned handle: `setTitle`, `resize`, `move`, `focus`, `minimize`, `maximize`, `setAlwaysOnTop`, `setBeforeClose`, `close`, `postMessage`, `on('close'\|'message'\|'beforeclose')` |
| `neo.app` | `exit`, `getManifest`, `list`, `readAsset(path)` for files in the caller's package, `launch(id,args)` (`app.launch`) |
| `neo.account` | `self()`, `list()` (`account.manage`, admin only), `create(data)` (`account.manage`, admin only) |
| `neo.process` | `self`, `list` (`process.list`), `focus(pid)` (`process.focus`), `minimize(pid)` (`process.minimize`), `kill(pid)` (`process.kill`) |
| `neo.theme` | `get`, `set(name)` (`theme.set`) |
| `neo.desktop` | `getWallpaper`, `listWallpapers`, `setWallpaper(id)` (`desktop.customize`) |
| `neo.system` | `getApiVersion`, `supports(feature)`, `info`, `storage()`, `lock()` |
| `neo.log` | `write(level,message)`, `read(limit)` (`log.read`) |
| `neo.fs` | `list(path)`, `read(path)`, `write(path,content,mime)`, `mkdir(path)`, `remove(path)`, `move(from,to)`; `/` is the signed-in account's private home root. `write` accepts text or byte arrays; system files and other accounts are outside the app-visible namespace. |
| `neo.dialog` | `openFile({accept,startPath})` shows a neoOS-owned picker backed by the VFS and returns a path or `null`; `alert({title,message})` shows an error dialog; `confirm({title,message})` shows a confirmation dialog; `choose({title,message,options})` asks the user to choose an action |

Uncaught app exceptions and unhandled promise rejections are logged and shown in a neoOS error dialog. Apps should use `neo.dialog.alert` when they catch an error and cannot recover. The kernel keeps recent events in a bounded in-memory journal; the Log Viewer reads it through the permissioned `log.read` call. User accounts are local browser-profile accounts; passwords are PBKDF2-SHA-256 verifiers, not system credentials. Other planned namespaces return `ENOSYS` until implemented.

Apps may request an external HTTPS editor with `neo.window.create({content:{url}})` only when that URL's exact origin appears in their manifest `network` list. Remote frames stay on their own origin, and the kernel routes their `postMessage` data to the owning process as `window:remote-message`. The kernel rejects the OS's own origin for this mode. A window may request the system file action with `openFileAction:true`; the process receives `window:action` and can open the neoOS file picker itself. Remote frames emit `window:remote-ready` and `window:remote-error` lifecycle events.

## Lifecycle

Process events: `launch(args)`, `activate(args)` for subsequent launches of a single-instance app, and `theme:changed`. Windows emit `beforeclose` when guarded, then `close` when closed. `neo.app.exit()` ends the caller; the kernel can also kill a PID. A process with no windows stays alive when `exitWhenLastWindowCloses` is `false`.

Permission scopes use exact names or a trailing `*` prefix wildcard. For example, `neo.process.list` requires `process.list` in the manifest. Missing permission returns `EACCES`.
