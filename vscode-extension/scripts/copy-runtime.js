#!/usr/bin/env node
/**
 * Copy the web-agent runtime (the standalone agent and its full require closure)
 * from the repo's src/ into vscode-extension/runtime/, so it can be packaged
 * inside the .vsix. At runtime the extension spawns runtime/agent/server.js with
 * the editor's own Node (ELECTRON_RUN_AS_NODE) to host the web portal.
 *
 * The directory structure is preserved so the agent's relative requires
 * (../core, ../main, ../renderer) resolve unchanged. The agent depends only on
 * Node builtins plus these files, so no node_modules is needed.
 */
const fs = require('fs');
const path = require('path');

const srcRoot = path.join(__dirname, '..', '..', 'src');
const outRoot = path.join(__dirname, '..', 'runtime');

// The exact require closure of src/agent/server.js, verified by tracing every
// relative require. A miss here = MODULE_NOT_FOUND when the portal spawns.
const FILES = [
  'agent/server.js',
  'agent/public/portpilot-web.js',
  'core/dispatch.js',
  'core/configPath.js',
  'core/configFile.js',
  'core/status.js',
  'main/configStore.js',
  'main/portScanner.js',
  'main/processManager.js',
  'main/ipcHandlers.js',
  'main/projectScanner.js',
  'renderer/index.html',
  'renderer/renderer.js',
  'renderer/styles.css',
];

fs.rmSync(outRoot, { recursive: true, force: true });
for (const rel of FILES) {
  const from = path.join(srcRoot, rel);
  const to = path.join(outRoot, rel);
  if (!fs.existsSync(from)) {
    console.error(`copy-runtime: MISSING source ${from}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log(`copy-runtime: copied ${FILES.length} files into runtime/`);
