# Tutorial: Hello World app

An app is **metadata + code**. The manifest never describes a window; your code opens windows itself.

## 1. Folder
```
applications/hello/
  manifest.json
  main.js
  view.html
  icon.svg
```
Add `"hello"` to `os/apps.index.json` (installed apps in Phase 6 are discovered automatically).

## 2. `manifest.json`
```json
{ "id": "com.example.hello", "name": "Hello", "version": "1.0.0",
  "description": "Says hello", "icon": "icon.svg", "main": "main.js", "minApiVersion": "1.0",
  "categories": ["Utilities"], "permissions": [], "network": [], "instance": "multi",
  "autostart": false, "exitWhenLastWindowCloses": true, "associations": [], "intents": [], "contributes": {} }
```

## 3. `main.js` (runs in a sandboxed process; `neo` is a global)
```js
neo.on('launch', args => neo.log.write('info', `launched with ${JSON.stringify(args)}`));
neo.window.create({
  title: 'Hello', width: 360, height: 220, minWidth: 240, resizable: true,
  content: { file: 'view.html' }          // or { html: '<h1>Hi</h1>' }
}).then(win => {
  win.on('message', m => win.setTitle('Hello, ' + m.name));
  win.on('close', () => neo.log.write('info', 'window closed'));
});
```

## 4. `view.html` (the window's frame; style it with neoUI, talk to `main.js` with `neoWindow`)
```html
<div class="u-p-4 u-flex u-col u-gap-2">
  <h2>Hello, neoOS!</h2>
  <input id="n" class="neo-input" placeholder="Your name">
  <button class="neo-btn neo-btn--primary" id="go">Greet</button>
</div>
<script>go.onclick = () => neoWindow.postMessage({ name: n.value })</script>
```
Window files must be self-contained (inline `<script>`/`<style>`); the frame has an opaque origin, so relative URLs do not resolve.

## 5. Lifetime
Closing the last window ends the process unless `exitWhenLastWindowCloses` is `false` (tray apps/daemons, which have no window at all). Call `neo.app.exit()` to quit, or use the Task Manager (`neo.process.kill`).
