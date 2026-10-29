// Fails if any source file references Bootstrap/jQuery. Run: node tools/lint-bootstrap.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
const bad = /bootstrap|jquery|data-bs-/i; let fail = 0;
const walk = d => { for (const f of readdirSync(d)) { if (['node_modules', '.git', 'tools', 'docs'].includes(f)) continue; const p = d + '/' + f, s = statSync(p);
  // Generated Office bundles contain third-party OOXML terminology and are not app source.
  if (s.isDirectory()) walk(p); else if (/\.(js|html|css|json)$/.test(f) && !f.endsWith('.vendor.js') && bad.test(readFileSync(p, 'utf8'))) { console.error('Forbidden reference in', p); fail = 1; } } };
walk('.'); process.exit(fail);
