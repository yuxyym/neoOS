// One-time patch: adapts the remaining neoOS files to the real host file system. Run from the project root:  node tools/apply-electron-patch.mjs
// All-or-nothing: nothing is written unless every edit matches exactly once. Line endings are normalised to LF.
import fs from 'node:fs';
const MARK = '.neoos-electron-patched';
if (fs.existsSync(MARK)) { console.log('Already patched (delete ' + MARK + ' to force a re-check).'); process.exit(0); }

const office = (ext, label) => ({ file: `applications/office-${label}/main.js`, edits: [
  ["neo.on('launch', async args => {", "neo.on('launch', async args => {\n  const home = (await neo.system.paths()).home;"],
  ["neo.dialog.openFile({ startPath: '/', accept:", 'neo.dialog.openFile({ accept:'],
  ["(await neo.fs.list('/')).map(entry => entry.name)", '(await neo.fs.list(home)).map(entry => entry.name)'],
  [": `/${name}`;", ": `${home}/${name}`;"],
] });
const PATCHES = [
  office('docx', 'document'), office('pptx', 'presentation'), office('xlsx', 'spreadsheet'),
  { file: 'applications/image-viewer/main.js', edits: [["{ accept: 'image/*', startPath: '/' }", "{ accept: 'image/*' }"]] },
  { file: 'applications/notepad/main.js', edits: [
    ["neo.dialog.openFile({ startPath: '/' })", 'neo.dialog.openFile()'],
    ["let dir = '/'; try { await neo.fs.list('/Documents'); dir = '/Documents'; } catch {}", "const home = (await neo.system.paths()).home; let dir = home; try { await neo.fs.list(`${home}/Documents`); dir = `${home}/Documents`; } catch {}"],
  ] },
  { file: 'applications/settings/main.js', edits: [
    ["{ accept: 'image/*', startPath: '/' }", "{ accept: 'image/*' }"],
    ["const used = new Set((await neo.fs.list('/')).map(e => e.name));", 'const dest = (await neo.system.paths()).downloads, used = new Set((await neo.fs.list(dest)).map(e => e.name));'],
    ['neo.fs.write(`/${target}`,', 'neo.fs.write(`${dest}/${target}`,'],
  ] },
  { file: 'applications/settings/view.html', edits: [
    ["Imported files are copied into your neoOS home and stored in this browser's local database. They stay available even if the original file changes or is deleted.", 'Imported files are copied into your Downloads folder on this computer.'],
    ['Saved ${d.imported} to your neoOS home.', 'Saved ${d.imported} to your Downloads folder.'],
    ['<h2>neoOS storage</h2>', '<h2>Disk storage</h2>'],
  ] },
  { file: 'applications/calendar/main.js', edits: [
    ["JSON.parse((await neo.fs.read('/.calendar-events.json')).content||'[]')", "JSON.parse((await neo.storage.get('events'))||'[]')"],
    ["await neo.fs.write('/.calendar-events.json',JSON.stringify(m.events,null,2),'application/json')", "await neo.storage.set('events',JSON.stringify(m.events))"],
  ] },
  { file: 'applications/paint/main.js', edits: [
    ["const files=await neo.fs.list('/'),", 'const dir=(await neo.system.paths()).pictures,files=await neo.fs.list(dir),'],
    ['neo.fs.write(`/${name}`,m.save', 'neo.fs.write(`${dir}/${name}`,m.save'],
  ] },
  { file: 'applications/paint/view.html', edits: [['Saved ${m.saved} to /', 'Saved ${m.saved} to Pictures']] },
  { file: 'os/shell.js', edits: [
    ["import { soundsEnabled, setSoundsEnabled } from './sound.js';", "import { soundsEnabled, setSoundsEnabled } from './sound.js';\nimport * as host from './host.js';"],
    ["m.append(item('Lock screen', lock));", "m.append(item('Lock screen', lock));\n  if (host.available) m.append(item('Quit neoOS', () => host.call('host:quit')));"],
  ] },
  { file: 'os/file-picker.js', edits: [
    ['startPath || `${homePath}/Pictures`', 'startPath || homePath'],
    ['if (current !== homePath && !current.startsWith(`${homePath}/`)) current = `${homePath}/Pictures`;', ''],
    ["if (current !== homePath) list.append(", "if (current !== '/') list.append("],
    ["|| homePath; if (current !== homePath && !current.startsWith(`${homePath}/`)) current = homePath; render();", "|| '/'; render();"],
    ["if (entry.type === 'file' && !matches(entry)) continue;", "if (entry.name.startsWith('.') || (entry.type === 'file' && !matches(entry))) continue;"],
    ['Files stay inside neoOS storage.', 'Browsing files on this computer.'],
  ] },
  { file: 'applications/file-manager/view.html', edits: [
    [/function placesUI\(\)\{[\s\S]*?\nfunction row\(e\)\{/, `function placesUI(){$('places').replaceChildren(Object.assign(document.createElement('div'),{className:'neo-sidebar__label',textContent:'Places'}),...(S.places||[]).map(p=>{const b=document.createElement('button');b.className='neo-sidebar__item'+(S.path===p.path&&!searching?' is-active':'');b.textContent=\`\${p.glyph}  \${p.name}\`;b.onclick=()=>send('go',{path:p.path});return b}))}
function crumbsUI(){const parts=S.path.split('/').filter(Boolean),c=[],sep=()=>Object.assign(document.createElement('span'),{textContent:'›'});const add=(l,p)=>{const b=document.createElement('button');b.textContent=l;b.onclick=()=>send('go',{path:p});c.push(b)};
 add('▥','/');let acc='';for(const p of parts){acc+='/'+p;c.push(sep());add(p,acc)}
 if(searching)c.push(Object.assign(document.createElement('span'),{textContent:'›  Search results'}));$('crumbs').replaceChildren(...c);$('crumbs').scrollLeft=1e6}
function row(e){`],
    ["add('New folder',()=>send('new-folder'),searching);", "add('Open terminal here',()=>send('terminal',{path:sel&&onItem&&sel.type==='directory'?sel.path:S.path}));add('New folder',()=>send('new-folder'),searching);"],
  ] },
  { file: 'index.html', edits: [['<link rel="stylesheet" href="neoui/shell.css">', '<link rel="stylesheet" href="neoui/shell.css">\n<link rel="stylesheet" href="neoui/retro.css">']] },
  { file: 'os/shell.js', edits: [
    ["[['dark', 'Dark'], ['light', 'Light']]", "[['aqua', 'Aqua'], ['classic', 'Classic'], ['dark', 'Dark'], ['light', 'Light']]"],
    ["dataset.theme === 'light' ? 'branding/neoicon.png'", "dataset.theme !== 'dark' ? 'branding/neoicon.png'"],
  ] },
  { file: 'applications/settings/view.html', edits: [
    ['<button id="dark">Dark</button><button id="light">Light</button>', '<button id="aqua">Aqua</button><button id="classic">Classic</button><button id="dark">Dark</button><button id="light">Light</button>'],
    ["$('dark').onclick=()=>post({theme:'dark'});$('light').onclick=()=>post({theme:'light'});", "['aqua','classic','dark','light'].forEach(t=>$(t).onclick=()=>post({theme:t}));"],
    ["$('dark').classList.toggle('is-active',d.theme==='dark');$('light').classList.toggle('is-active',d.theme==='light');", "['aqua','classic','dark','light'].forEach(t=>$(t).classList.toggle('is-active',d.theme===t));"],
  ] },
];

const texts = new Map(); let failed = false;
for (const p of PATCHES) {
  if (!fs.existsSync(p.file)) { console.error('Missing file: ' + p.file); failed = true; continue; }
  let text = texts.get(p.file) ?? fs.readFileSync(p.file, 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to] of p.edits) {
    const n = from instanceof RegExp ? (from.test(text) ? 1 : 0) : text.split(from).length - 1;
    if (n === 1) text = text.replace(from, () => to);
    else if (n === 0 && typeof from === 'string' && to && text.includes(to)) console.log(`  (already applied) ${p.file}`);
    else { console.error(`${p.file}: expected exactly 1 match, found ${n} for: ${String(from).slice(0, 70)}`); failed = true; }
  }
  texts.set(p.file, text);
}
if (failed) { console.error('\nNo files were changed. Make sure this is the unmodified neoOS project, then send me the messages above.'); process.exit(1); }
for (const [f, t] of texts) { fs.writeFileSync(f, t); console.log('patched ' + f); }
fs.writeFileSync(MARK, 'neoOS Electron patch applied\n');
console.log('\nDone. Next: npm install && npm start');
