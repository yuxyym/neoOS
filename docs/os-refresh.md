# neoOS refresh: review notes and changes

## Bugs fixed
- **Dead buttons / labels (window-property collisions).** Element ids such as `open`, `name` and `status` collide with built-in `window.*` properties, so `open.onclick = …` set a property on `window.open` instead of the button. Fixed in Notepad (Open button, filename and status), File Manager (Open button), Image Viewer (filename) and Search (status). Rule of thumb: in window views use `document.getElementById`, never bare id globals.
- **Clock:** the timer ran at double speed (two intervals each decremented it) and its alert called `neo.dialog` inside a window frame, where `neo` does not exist. Now timestamp based; finishing posts a message to `main.js`, which uses the new `neo.notify.show`.
- **Paint:** listed `/` with only `fs.write` permission, so saving always failed. Manifest now grants `fs.read`.
- **Calculator:** editable display double-typed every key and Enter fired twice. `%` is now a real percent.
- **File Manager:** rename from search results moved files into the wrong folder; pasting a folder into itself recursed forever; paste silently overwrote; non-empty folders could not be deleted; bursts of fs calls hit the rate limiter.
- **Window focus:** clicking inside an app did not raise it (pointer events never leave the iframe). The window manager now raises a window when its iframe takes focus, so the first click both focuses and works.
- **Light theme flash:** windows now start with the current theme baked in.
- **Kernel:** `..` check in `inlineAppAssets` was a malformed regex; rate limiter raised to a 200-call burst / 200 per second; `$` in inlined assets no longer corrupts replacements.
- **Lock screen:** anyone could create an account from the sign-in screen. Creation is now only offered while no account exists; admins add users in Settings.
- **Terminal:** `constructor`, `toString` etc. resolved to Object members; now `Object.hasOwn`.

## New API
`neo.notify.show({ title, message, sound })` shows a toast (no permission needed). `sound` is `'message'` (default), `'alarm'` or `false`.

## OS feel
Native system font and 14px scale; slim glass top panel; app launcher (Alt+Space) with search; dock with running indicators, launch bounce and right-click menus; desktop icons; right-click menus (desktop, windows, dock) with the browser menu suppressed; resizable window edges, snap left/right/maximize, minimize/close animations; lock screen with clock and avatars; notifications; system sounds (toggle in the panel's user menu).

## Still open
- `resources/neo-os.css`, `neo-os.js` and the WinBox bundle are unused leftovers and can be deleted. `lint-bootstrap` can stay.
- Fonts: the shell uses the system UI font. Inter is not loaded because app frames cannot fetch cross-origin fonts.

## Note for VS Code Live Server users
Live Server injects a reload script into every HTML response at the first `</body>` or `</svg>` it finds. A literal `</svg>` inside a window's `<script>` therefore gets a script dropped into the middle of your JavaScript string, and the rest of the file shows up as plain text. View files must not contain a literal `</svg>` (or `</body>`) inside script strings; build such strings with `'</'+'svg>'`.
