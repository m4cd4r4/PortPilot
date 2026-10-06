#!/usr/bin/env node
// Builds the MCP server that ships inside the Claude Code plugin.
//
// A plugin installed from git gets no `npm install`, so mcp-server/index.js is
// bundled with its one dependency (@modelcontextprotocol/sdk) into a single ESM
// file. The two core helpers it loads at runtime (configFile, status) are copied
// next to it as .cjs, the same layout electron-builder ships (see "build" in
// package.json), so loadCore() finds them without any source change.
//
//   node scripts/build-plugin.mjs           write plugin/mcp/
//   node scripts/build-plugin.mjs --check   exit 1 if plugin/mcp/ is stale
//
// The output is committed. tests/plugin-bundle.test.cjs runs --check.

import { build } from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'plugin', 'mcp');
const check = process.argv.includes('--check');

async function buildTo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  await build({
    absWorkingDir: root, // path comments in the bundle must not depend on cwd
    entryPoints: [path.join(root, 'mcp-server', 'index.js')],
    outfile: path.join(dir, 'portpilot-mcp.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    legalComments: 'none',
    logLevel: 'warning',
    // CJS dependencies inside an ESM bundle still call require() for builtins.
    // Set on globalThis: a top-level `const require` would collide with the one
    // index.js declares for loadCore().
    banner: { js: "import { createRequire as __ppCreateRequire } from 'module'; globalThis.require ??= __ppCreateRequire(import.meta.url);" },
  });
  // LF always: a Windows checkout (core.autocrlf) has CRLF sources, and the
  // committed copies must match a build on either OS byte for byte.
  for (const name of ['configFile', 'status']) {
    const src = fs.readFileSync(path.join(root, 'src', 'core', `${name}.js`), 'utf8');
    fs.writeFileSync(path.join(dir, `${name}.cjs`), src.replace(/\r\n/g, '\n'));
  }
  return fs.readdirSync(dir).sort();
}

if (!check) {
  const files = await buildTo(outDir);
  console.log(`plugin/mcp: ${files.join(', ')}`);
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-plugin-'));
try {
  const files = await buildTo(tmp);
  const stale = files.filter((f) => {
    const committed = path.join(outDir, f);
    return !fs.existsSync(committed)
      || !fs.readFileSync(committed).equals(fs.readFileSync(path.join(tmp, f)));
  });
  if (stale.length) {
    console.error(`plugin/mcp is stale (${stale.join(', ')}). Run: npm run build:plugin`);
    process.exit(1);
  }
  console.log('plugin/mcp is up to date');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
