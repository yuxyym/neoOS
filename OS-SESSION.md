# neoOS as the operating system session

`npm run session` (or `electron . --session`) runs neoOS as the whole desktop: kiosk full screen, cannot be closed or un-fullscreened, no devtools.
`npm run install-session` registers it to start at boot (Linux login-screen session, macOS LaunchAgent, Windows shell replacement; see the script output).

## Linked to the real computer
Volume/mute (pactl/amixer, osascript, Windows Core Audio), Wi‑Fi (nmcli, networksetup, netsh), Bluetooth (bluetoothctl, blueutil, Windows read-only), keyboard layout and repeat rate (Linux X11), brightness (brightnessctl / WMI), battery, and real Sleep / Restart / Shut down.
Needs: Linux `network-manager`, `pulseaudio-utils` or `alsa-utils`, `bluez`, optional `brightnessctl`; macOS optional `blueutil`.
Hardware volume keys are handled; the panel pills show the live Wi‑Fi network and volume.

## Settings and file associations
Settings is a macOS-style app (search, Wi‑Fi, Bluetooth, Sound, Display, Keyboard, Wallpaper, Desktop & Dock, Default Apps, Date & Time, Users, Storage, Battery & Power, About).
Default Apps edits one system-wide store that Files uses for "Open with".
New API (permission `system.control`): `neo.sysctl.call(action, args)`, `neo.assoc.get()`, `neo.assoc.set(ext, appId|null)`.
