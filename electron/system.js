'use strict';
// Host system control: volume, Wi-Fi, Bluetooth, keyboard, brightness, battery, power. Linux (nmcli/pactl/bluetoothctl), macOS, Windows (best effort).
const { ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs'), P = process.platform, ORIGIN = 'neoos://app/', SESSION = process.argv.includes('--session');
const E = (code, message) => Object.assign(new Error(message), { code });
const run = (cmd, args = [], t = 15000) => new Promise((ok, no) => execFile(cmd, args, { timeout: t, windowsHide: true, maxBuffer: 8e6 }, (e, out, err) =>
  e ? no(E(e.code === 'ENOENT' ? 'ENOSYS' : 'EIO', (String(err || '').trim().split('\n')[0] || e.message))) : ok(String(out))));
const soft = async (...a) => { try { return await run(...a); } catch { return null; } };
const ps = (s, t) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', s], t || 20000);
const pct = v => Math.min(100, Math.max(0, Math.round(+v) || 0));
const split = l => l.split(/(?<!\\):/).map(s => s.replace(/\\:/g, ':'));
const str = (v, max = 64) => { v = String(v ?? ''); if (!v || v.length > max || v.startsWith('-') || /[\0\r\n]/.test(v)) throw E('EINVAL', 'Invalid value'); return v; };
const MAC = /^[0-9A-Fa-f:-]{17}$/;

const WIN_AUDIO = `Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float l, System.Guid c); int j(); int GetMasterVolumeLevelScalar(out float l); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool b, System.Guid c); int GetMute(out bool b); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int ctx, int p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-46C4-9D5D-F0F6E34B1CB3")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume V() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d; e.GetDefaultAudioEndpoint(0,1,out d); var g = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v; d.Activate(ref g,23,0,out v); return v; }
  public static float Get(){ float f; V().GetMasterVolumeLevelScalar(out f); return f; }
  public static void Set(float f){ V().SetMasterVolumeLevelScalar(f, System.Guid.Empty); }
  public static bool GetMute(){ bool b; V().GetMute(out b); return b; }
  public static void SetMute(bool b){ V().SetMute(b, System.Guid.Empty); }
}
'@
`;
const vol = {
  async get() {
    if (P === 'linux') {
      const o = await soft('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
      if (o) { const mu = await soft('pactl', ['get-sink-mute', '@DEFAULT_SINK@']); return { volume: pct(/(\d+)%/.exec(o)?.[1]), muted: /yes/.test(mu || '') }; }
      const a = await run('amixer', ['get', 'Master']); return { volume: pct(/\[(\d+)%\]/.exec(a)?.[1]), muted: /\[off\]/.test(a) };
    }
    if (P === 'darwin') { const g = async k => (await run('osascript', ['-e', `${k} of (get volume settings)`])).trim(); return { volume: pct(await g('output volume')), muted: (await g('output muted')) === 'true' }; }
    const o = (await ps(WIN_AUDIO + '[Audio]::Get(); [Audio]::GetMute()')).trim().split(/\r?\n/);
    return { volume: pct(parseFloat(o[0].replace(',', '.')) * 100), muted: /true/i.test(o[1]) };
  },
  async set(v) {
    if (P === 'linux') { if (await soft('pactl', ['set-sink-volume', '@DEFAULT_SINK@', v + '%']) == null) await run('amixer', ['set', 'Master', v + '%']); }
    else if (P === 'darwin') await run('osascript', ['-e', `set volume output volume ${v}`]);
    else await ps(WIN_AUDIO + `[Audio]::Set(${(v / 100).toFixed(2)})`);
  },
  async mute(m) {
    if (P === 'linux') { if (await soft('pactl', ['set-sink-mute', '@DEFAULT_SINK@', m ? '1' : '0']) == null) await run('amixer', ['set', 'Master', m ? 'mute' : 'unmute']); }
    else if (P === 'darwin') await run('osascript', ['-e', `set volume output muted ${m}`]);
    else await ps(WIN_AUDIO + `[Audio]::SetMute($${m})`);
  },
};

const macDev = async re => { const o = await soft('networksetup', ['-listallhardwareports']); return o && new RegExp(`Hardware Port: (?:${re})\\s*\\nDevice: (\\w+)`).exec(o)?.[1]; };
const AIRPORT = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';
const wifi = {
  async status() {
    if (P === 'linux') {
      const r = await soft('nmcli', ['-t', 'radio', 'wifi']); if (r == null) return { supported: false };
      const a = (await soft('nmcli', ['-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi']) || '').split('\n').map(split).find(x => x[0] === 'yes');
      return { supported: true, enabled: r.trim() === 'enabled', ssid: a?.[1] || null };
    }
    if (P === 'darwin') {
      const d = await macDev('Wi-Fi|AirPort'); if (!d) return { supported: false };
      const pw = await run('networksetup', ['-getairportpower', d]), n = await soft('networksetup', ['-getairportnetwork', d]);
      return { supported: true, enabled: /On/.test(pw), ssid: /Network: (.+)/.exec(n || '')?.[1]?.trim() || null };
    }
    const o = await soft('netsh', ['wlan', 'show', 'interfaces']); if (!o || /no wireless/i.test(o)) return { supported: false };
    return { supported: true, enabled: true, canPower: false, ssid: /^\s*SSID\s*:\s*(.+)$/m.exec(o)?.[1]?.trim() || null };
  },
  async power({ on }) {
    if (P === 'linux') return void await run('nmcli', ['radio', 'wifi', on ? 'on' : 'off']);
    if (P === 'darwin') return void await run('networksetup', ['-setairportpower', await macDev('Wi-Fi|AirPort'), on ? 'on' : 'off']);
    throw E('ENOSYS', 'Wi-Fi cannot be switched off from here on Windows.');
  },
  async scan() {
    if (P === 'linux') {
      const seen = new Map();
      for (const l of (await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'auto'], 25000)).split('\n')) {
        const [use, ssid, sig, sec] = split(l); if (!ssid) continue;
        const n = { ssid, signal: +sig || 0, secure: !!sec && sec !== '--', active: use === '*' }; if (!seen.has(ssid) || seen.get(ssid).signal < n.signal || n.active) seen.set(ssid, n);
      }
      return [...seen.values()].sort((a, b) => b.active - a.active || b.signal - a.signal);
    }
    if (P === 'darwin') {
      const o = await soft(AIRPORT, ['-s']); if (!o) return [];
      return o.split('\n').slice(1).map(l => { const m = /^\s*(.+?)\s+[0-9a-f:]{17}\s+(-\d+)\s+.*?\s(\S+)\s*$/i.exec(l); return m && { ssid: m[1], signal: pct(2 * (+m[2] + 100)), secure: !/NONE/.test(m[3]), active: false }; }).filter(Boolean);
    }
    const o = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']), out = [];
    for (const b of o.split(/\n(?=SSID \d+)/)) { const s = /^SSID \d+ : (.*)$/m.exec(b); if (s && s[1].trim()) out.push({ ssid: s[1].trim(), signal: pct(/Signal\s*:\s*(\d+)/.exec(b)?.[1]), secure: !/Open/.test(/Authentication\s*:\s*(.*)/.exec(b)?.[1] || ''), active: false }); }
    return out;
  },
  async connect({ ssid, password }) {
    ssid = str(ssid, 32);
    if (P === 'linux') return void await run('nmcli', ['dev', 'wifi', 'connect', ssid, ...(password ? ['password', str(password, 80)] : [])], 40000);
    if (P === 'darwin') return void await run('networksetup', ['-setairportnetwork', await macDev('Wi-Fi|AirPort'), ssid, ...(password ? [str(password, 80)] : [])], 40000);
    await run('netsh', ['wlan', 'connect', `name=${ssid}`], 30000);
  },
  async disconnect() {
    if (P === 'linux') { const d = (await run('nmcli', ['-t', '-f', 'DEVICE,TYPE', 'dev'])).split('\n').map(split).find(x => x[1] === 'wifi'); if (d) await run('nmcli', ['dev', 'disconnect', d[0]]); }
    else if (P === 'darwin') { const d = await macDev('Wi-Fi|AirPort'); await run('networksetup', ['-setairportpower', d, 'off']); await run('networksetup', ['-setairportpower', d, 'on']); }
    else await run('netsh', ['wlan', 'disconnect']);
  },
};

const bt = {
  async status() {
    if (P === 'linux') { const o = await soft('bluetoothctl', ['show']); return o ? { supported: true, enabled: /Powered: yes/.test(o) } : { supported: false }; }
    if (P === 'darwin') { const o = await soft('blueutil', ['-p']); return o == null ? { supported: false, hint: 'Install blueutil (brew install blueutil) to control Bluetooth.' } : { supported: true, enabled: o.trim() === '1' }; }
    const o = await soft('powershell.exe', ['-NoProfile', '-Command', '(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Measure-Object).Count']);
    return +o > 0 ? { supported: true, enabled: true, canPower: false } : { supported: false };
  },
  async power({ on }) {
    if (P === 'linux') { if (on) await soft('rfkill', ['unblock', 'bluetooth']); return void await run('bluetoothctl', ['power', on ? 'on' : 'off']); }
    if (P === 'darwin') return void await run('blueutil', ['-p', on ? '1' : '0']);
    throw E('ENOSYS', 'Bluetooth cannot be switched from here on Windows.');
  },
  async devices() {
    if (P === 'linux') {
      const o = await soft('bluetoothctl', ['devices']) || '';
      return Promise.all([...o.matchAll(/^Device ([0-9A-F:]{17}) (.*)$/gmi)].slice(0, 30).map(async m => {
        const i = await soft('bluetoothctl', ['info', m[1]]) || ''; return { id: m[1], name: m[2], connected: /Connected: yes/.test(i), paired: /Paired: yes/.test(i) };
      }));
    }
    if (P === 'darwin') return [...(await soft('blueutil', ['--paired']) || '').matchAll(/address: ([\w-]+), (not connected|connected[^,]*),.*?name: "([^"]*)"/g)].map(m => ({ id: m[1], name: m[3], connected: !/^not/.test(m[2]), paired: true }));
    const o = await soft('powershell.exe', ['-NoProfile', '-Command', 'Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Select-Object FriendlyName,Status | ConvertTo-Json -Compress']);
    try { return [].concat(JSON.parse(o || '[]')).map(d => ({ id: d.FriendlyName, name: d.FriendlyName, connected: d.Status === 'OK', paired: true, readonly: true })); } catch { return []; }
  },
  async scan() { if (P === 'linux') await soft('bluetoothctl', ['--timeout', '6', 'scan', 'on'], 9000); return bt.devices(); },
  async connect({ id }) { if (!MAC.test(id)) throw E('EINVAL', 'Bad device'); if (P === 'linux') await run('bluetoothctl', ['connect', id], 25000); else if (P === 'darwin') await run('blueutil', ['--connect', id], 25000); else throw E('ENOSYS', 'Use Windows Settings to connect devices.'); },
  async disconnect({ id }) { if (!MAC.test(id)) throw E('EINVAL', 'Bad device'); if (P === 'linux') await run('bluetoothctl', ['disconnect', id]); else if (P === 'darwin') await run('blueutil', ['--disconnect', id]); else throw E('ENOSYS', 'Use Windows Settings to disconnect devices.'); },
};

const LAYOUTS = ['us', 'gb', 'de', 'fr', 'es', 'it', 'pt', 'br', 'ru', 'ua', 'pl', 'cz', 'se', 'no', 'dk', 'fi', 'nl', 'ch', 'ca', 'tr', 'il', 'jp', 'kr', 'in'];
const kb = {
  async get() {
    if (P === 'linux') { const o = await soft('setxkbmap', ['-query']); return o ? { supported: true, layout: /layout:\s+(\S+)/.exec(o)?.[1] || '', layouts: LAYOUTS, canRepeat: true } : { supported: false }; }
    if (P === 'darwin') { const o = await soft('defaults', ['read', 'com.apple.HIToolbox', 'AppleCurrentKeyboardLayoutInputSourceID']); return { supported: false, layout: (o || '').trim().replace('com.apple.keylayout.', '') }; }
    const o = await soft('powershell.exe', ['-NoProfile', '-Command', '(Get-WinUserLanguageList)[0].LanguageTag']); return { supported: false, layout: (o || '').trim() };
  },
  async set({ layout }) { if (!/^[a-z]{2,3}(\(\w+\))?$/.test(layout || '')) throw E('EINVAL', 'Bad layout'); await run('setxkbmap', [layout]); },
  async repeat({ delay, rate }) { await run('xset', ['r', 'rate', String(Math.min(2000, Math.max(100, Math.round(delay) || 500))), String(Math.min(100, Math.max(5, Math.round(rate) || 25)))]); },
};
const bright = {
  async get() {
    if (P === 'linux') { const o = await soft('brightnessctl', ['-m']); const m = o && /,(\d+)%,/.exec(o); return m ? { supported: true, brightness: +m[1] } : { supported: false }; }
    if (P === 'win32') { const o = await soft('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness']); return o && +o ? { supported: true, brightness: pct(o) } : { supported: false }; }
    return { supported: false };
  },
  async set({ brightness }) {
    const v = Math.min(100, Math.max(5, Math.round(brightness) || 50));
    if (P === 'linux') await run('brightnessctl', ['set', v + '%']);
    else if (P === 'win32') await ps(`Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=${v}}`);
    else throw E('ENOSYS', 'Not supported');
  },
};
async function battery() {
  if (P === 'linux') {
    try { const d = fs.readdirSync('/sys/class/power_supply').find(n => /^BAT/.test(n)); if (!d) return { present: false };
      const r = f => fs.readFileSync(`/sys/class/power_supply/${d}/${f}`, 'utf8').trim(); return { present: true, percent: +r('capacity'), charging: !/discharging/i.test(r('status')) }; } catch { return { present: false }; }
  }
  if (P === 'darwin') { const m = /(\d+)%;\s*([\w ]+)/.exec(await soft('pmset', ['-g', 'batt']) || ''); return m ? { present: true, percent: +m[1], charging: !/discharging/.test(m[2]) } : { present: false }; }
  const o = await soft('powershell.exe', ['-NoProfile', '-Command', '$b=Get-CimInstance Win32_Battery; if($b){"$($b.EstimatedChargeRemaining),$($b.BatteryStatus)"}']);
  const m = /(\d+),(\d+)/.exec(o || ''); return m ? { present: true, percent: +m[1], charging: m[2] !== '1' } : { present: false };
}
const power = {
  async shutdown() { if (P === 'linux') { if (await soft('systemctl', ['poweroff']) == null) await run('loginctl', ['poweroff']); } else if (P === 'darwin') await run('osascript', ['-e', 'tell app "System Events" to shut down']); else await run('shutdown', ['/s', '/t', '0']); },
  async restart() { if (P === 'linux') { if (await soft('systemctl', ['reboot']) == null) await run('loginctl', ['reboot']); } else if (P === 'darwin') await run('osascript', ['-e', 'tell app "System Events" to restart']); else await run('shutdown', ['/r', '/t', '0']); },
  async sleep() { if (P === 'linux') await run('systemctl', ['suspend']); else if (P === 'darwin') await run('pmset', ['sleepnow']); else await run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']); },
};
const WINPANEL = { wifi: 'network-wifi', bluetooth: 'bluetooth', keyboard: 'typing', sound: 'sound', display: 'display' };
const A = {
  info: () => ({ platform: P, session: SESSION }),
  'volume.get': () => vol.get(), 'volume.set': a => vol.set(pct(a.volume)), 'volume.mute': a => vol.mute(!!a.muted),
  'wifi.status': () => wifi.status(), 'wifi.power': a => wifi.power({ on: !!a.on }), 'wifi.scan': () => wifi.scan(), 'wifi.connect': a => wifi.connect(a), 'wifi.disconnect': () => wifi.disconnect(),
  'bt.status': () => bt.status(), 'bt.power': a => bt.power({ on: !!a.on }), 'bt.devices': () => bt.devices(), 'bt.scan': () => bt.scan(), 'bt.connect': a => bt.connect(a), 'bt.disconnect': a => bt.disconnect(a),
  'kb.get': () => kb.get(), 'kb.set': a => kb.set(a), 'kb.repeat': a => kb.repeat(a),
  'brightness.get': () => bright.get(), 'brightness.set': a => bright.set(a),
  battery,
  'power.shutdown': () => power.shutdown(), 'power.restart': () => power.restart(), 'power.sleep': () => power.sleep(),
  'native.open': async a => {
    const p = String(a.panel || '');
    if (P === 'win32') return void await run('cmd', ['/c', 'start', '', 'ms-settings:' + (WINPANEL[p] || '')]);
    if (P === 'darwin') return void await run('open', ['x-apple.systempreferences:']);
    if (await soft('gnome-control-center', [p]) == null) await run('systemsettings', []);
  },
};
ipcMain.handle('sys:call', async (e, action, args) => {
  if (!e.senderFrame || !e.senderFrame.url.startsWith(ORIGIN)) return { ok: false, error: { code: 'EACCES', message: 'Untrusted sender' } };
  try {
    const f = Object.hasOwn(A, action) && A[action]; if (!f) throw E('ENOSYS', 'Unknown system action');
    return { ok: true, result: await f(args && typeof args === 'object' ? args : {}) };
  } catch (err) { return { ok: false, error: { code: err.code || 'EIO', message: err.message } }; }
});
