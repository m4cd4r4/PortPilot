/**
 * vscode-extension/scripts/copy-runtime.js copies a fixed list of src/ files into
 * vscode-extension/runtime/. Every runtime module the compiled extension (out/*.js) loads must load
 * from a fresh copy, or the packaged extension (and CI) fails with MODULE_NOT_FOUND (F90:
 * browserProcess.js and browserProcessQuery.js were missing from the list while a stale local
 * runtime/ hid it). Each module is loaded in its own process, so nothing is shared between them.
 * Run: node tests/copy-runtime-closure.test.cjs   (part of npm run test:unit)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ext = path.join(__dirname, '..', 'vscode-extension');
execFileSync(process.execPath, [path.join(ext, 'scripts', 'copy-runtime.js')], { stdio: 'ignore' });

// What out/*.js asks for: require(path.join(__dirname, '..', 'runtime', 'core', 'x.js')) or '../runtime/core/x.js'.
const wanted = new Set();
for (const f of fs.readdirSync(path.join(ext, 'out')).filter((n) => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(ext, 'out', f), 'utf8');
  for (const m of src.matchAll(/'runtime',\s*'([^']+)',\s*'([^']+\.js)'/g)) wanted.add(`${m[1]}/${m[2]}`);
  for (const m of src.matchAll(/'\.\.\/runtime\/([^']+\.js)'/g)) wanted.add(m[1]);
}
// agent/server.js is spawned, not required, and loading it starts the web agent: not loaded here.
// (It does not load from a fresh copy today either: F91.)
wanted.delete('agent/server.js');

console.log('\n=== copy-runtime: what the extension loads, from a fresh runtime/ ===\n');
let passed = 0;
let failed = 0;
for (const rel of [...wanted].sort()) {
  const file = path.join(ext, 'runtime', rel);
  const r = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', file], { encoding: 'utf8' });
  const why = (r.stderr.match(/Cannot find module '[^']+'/) || [r.stderr.split('\n')[0]])[0];
  if (r.status === 0) { console.log(`✅ runtime/${rel} loads`); passed++; } else { console.log(`❌ runtime/${rel}: ${why}`); failed++; }
}
if (!wanted.size) { console.log('❌ found no runtime requires in out/: the pattern no longer matches'); failed++; }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
