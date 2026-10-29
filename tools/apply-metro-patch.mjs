// Removes the theme pickers (the look is fixed now). Run once from the project root:  node tools/apply-metro-patch.mjs
// All-or-nothing; safe to run twice.
import fs from 'node:fs';
const J = "['aqua','classic','dark','light']";
const PATCHES = [
  { file: 'os/shell.js', edits: [
    [/^[ \t]*const themeRow = .*\n/m, ''],
    ['m.append(head, themeRow, soundRow,', 'm.append(head, soundRow,'],
  ] },
  { file: 'applications/settings/view.html', edits: [
    [/[ \t]*<article class="neo-card panel"><h2>Theme<\/h2>[\s\S]*?<\/article>\n?/, ''],
    [`${J}.forEach(t=>$(t).onclick=()=>post({theme:t}));`, ''],
    [`${J}.forEach(t=>$(t).classList.toggle('is-active',d.theme===t));`, ''],
  ] },
];
const texts = new Map(); let failed = false;
for (const p of PATCHES) {
  if (!fs.existsSync(p.file)) { console.error('Missing file: ' + p.file); failed = true; continue; }
  let text = texts.get(p.file) ?? fs.readFileSync(p.file, 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to] of p.edits) {
    const n = from instanceof RegExp ? (from.test(text) ? 1 : 0) : text.split(from).length - 1;
    if (n === 1) text = text.replace(from, () => to);
    else if (n === 0) console.log(`  (already applied) ${p.file}: ${String(from).slice(0, 50)}`);
    else { console.error(`${p.file}: ${n} matches for ${String(from).slice(0, 70)}`); failed = true; }
  }
  texts.set(p.file, text);
}
if (failed) { console.error('\nNo files were changed.'); process.exit(1); }
for (const [f, t] of texts) { fs.writeFileSync(f, t); console.log('patched ' + f); }
