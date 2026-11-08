// Installs neoOS as a login session / shell so it takes over the screen at boot.
//   Linux:   sudo node tools/install-session.mjs        -> pick "neoOS" in your login screen (or autologin into it)
//   macOS:   node tools/install-session.mjs             -> LaunchAgent that starts neoOS at login
//   Windows: node tools/install-session.mjs             -> prints the registry command that makes neoOS the shell
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), win = process.platform === 'win32';
const electron = path.join(root, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron');
if (process.platform === 'linux') {
  const bin = '/usr/local/bin/neoos-session', desk = '/usr/share/xsessions/neoos.desktop';
  try {
    fs.writeFileSync(bin, `#!/bin/sh\ncd "${root}"\nexec "${electron}" . --session --no-sandbox\n`, { mode: 0o755 });
    fs.mkdirSync(path.dirname(desk), { recursive: true });
    fs.writeFileSync(desk, '[Desktop Entry]\nName=neoOS\nComment=neoOS desktop session\nExec=/usr/local/bin/neoos-session\nType=Application\nDesktopNames=neoOS\n');
    console.log('Installed. Choose the "neoOS" session at your login screen (or set it for autologin).\nWayland-only systems: run `cage -- ' + bin + '`.\nUninstall: sudo rm ' + bin + ' ' + desk);
  } catch (e) { console.error('Could not write system files (' + e.code + '). Re-run with: sudo node tools/install-session.mjs'); process.exit(1); }
} else if (process.platform === 'darwin') {
  const plist = path.join(os.homedir(), 'Library/LaunchAgents/org.neoos.session.plist');
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>org.neoos.session</string><key>ProgramArguments</key><array><string>${electron}</string><string>${root}</string><string>--session</string></array><key>RunAtLoad</key><true/></dict></plist>\n`);
  console.log('Installed ' + plist + '\nLoad now: launchctl load ' + plist + '\nEnable automatic login in System Settings > Users & Groups for a boot-to-neoOS experience.\nUninstall: launchctl unload ' + plist + ' && rm ' + plist);
} else {
  console.log('Make neoOS the Windows shell for your user (replaces Explorer). Run in an admin Command Prompt:\n\n  reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v Shell /t REG_SZ /d "\\"' + electron + '\\" \\"' + root + '\\" --session" /f\n\nRevert:  reg delete "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v Shell /f\nEnable automatic sign-in with netplwiz for boot-to-neoOS.');
}
