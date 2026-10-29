// Fetches the node-pty binary that matches Electron's ABI (best effort; the terminal falls back to script(1) on macOS/Linux otherwise).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
try {
  const pkgJson = require.resolve('@homebridge/node-pty-prebuilt-multiarch/package.json'), dir = path.dirname(pkgJson);
  const electron = require('electron/package.json').version, bin = require.resolve('prebuild-install/bin.js', { paths: [dir] });
  const r = spawnSync(process.execPath, [bin, '--runtime', 'electron', '--target', electron, '--arch', process.arch, '--platform', process.platform], { cwd: dir, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('prebuild-install exited with ' + r.status);
  console.log('node-pty ready for Electron ' + electron);
} catch (e) {
  console.warn('\n[neoOS] Could not install the native terminal backend (' + e.message + ').');
  console.warn('[neoOS] The terminal still works on macOS/Linux through script(1). On Windows, install build tools and run: npx @electron/rebuild\n');
}
