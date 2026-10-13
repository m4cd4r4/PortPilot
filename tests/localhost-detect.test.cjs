/**
 * Localhost detection rules (src/core/localhostDetect.js): which listening port is a
 * developer's own server, which project it belongs to, and its stable id.
 * Run: node tests/localhost-detect.test.cjs   (part of npm run test:unit)
 * Temp folders only.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classify, deriveProject, detectedAppId, inspectorPorts } = require('../src/core/localhostDetect');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const item = (over) => ({ port: 3000, pid: 100, address: '127.0.0.1:3000', processName: 'node.exe', commandLine: 'node server.js', ...over });
const dev = (over) => classify(item(over)).dev;

// ---- classify: dev servers -------------------------------------------------
t('node on a loopback port is a dev server', () => assert.strictEqual(dev({}), true));
t('every interface (0.0.0.0, [::], *) counts', () => {
  for (const address of ['0.0.0.0:3000', '[::]:3000', '*:3000', '[::1]:3000']) assert.strictEqual(dev({ address }), true, address);
});
t('python http.server, uvicorn, php, dotnet, bun, deno, java are dev runtimes', () => {
  for (const processName of ['python.exe', 'python3', 'pythonw.exe', 'uvicorn.exe', 'php.exe', 'dotnet.exe', 'bun.exe', 'deno.exe', 'java.exe', 'ruby.exe', 'npm.exe']) {
    assert.strictEqual(dev({ processName, commandLine: `${processName} app` }), true, processName);
  }
});
t('node --inspect serving :3000 is still a dev server (only the inspector port is skipped)', () => {
  assert.strictEqual(dev({ commandLine: 'node --inspect=9230 server.js' }), true);
  assert.strictEqual(dev({ port: 9230, address: '127.0.0.1:9230', commandLine: 'node --inspect=9230 server.js' }), false);
});
t('a port shared by two pids is judged binding by binding', () => {
  const r = classify(item({
    pid: 1, processName: 'svchost.exe', commandLine: '',
    bindings: [{ pid: 1, address: '[::]:3000', processName: 'svchost.exe', commandLine: '' }, { pid: 2, address: '127.0.0.1:3000', processName: 'node.exe', commandLine: 'node server.js' }],
  }));
  assert.strictEqual(r.dev, true);
});

// ---- classify: never a dev server -----------------------------------------
t('browsers, editors and agents are skipped', () => {
  for (const processName of ['brave.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe', 'Code.exe', 'Cursor.exe', 'windsurf.exe', 'claude.exe', 'electron.exe', 'Obsidian.exe']) {
    assert.strictEqual(dev({ processName }), false, processName);
  }
});
t('PortPilot itself and its own ports are skipped', () => {
  assert.strictEqual(dev({ processName: 'PortPilot.exe' }), false);
  assert.strictEqual(dev({ port: 8788, address: '127.0.0.1:8788' }), false);
  assert.strictEqual(dev({ port: 7317, address: '127.0.0.1:7317' }), false);
  assert.strictEqual(dev({ port: 4555, address: '127.0.0.1:4555' }), true);
  assert.strictEqual(classify(item({ port: 4555, address: '127.0.0.1:4555' }), { ownPorts: [4555] }).dev, false);
});
t('inspector and debug ports are skipped', () => {
  assert.strictEqual(dev({ port: 9229, address: '127.0.0.1:9229' }), false);
  assert.strictEqual(dev({ port: 9333, address: '127.0.0.1:9333', commandLine: 'node --inspect-port=9333 x.js' }), false);
  assert.deepStrictEqual([...inspectorPorts('node --inspect-brk=127.0.0.1:9240 --debug 5858 a.js')].sort(), [5858, 9240]);
});
t('MCP servers, agents, editor helpers and language servers are skipped', () => {
  for (const commandLine of [
    'node D:\\tools\\mcp-server\\index.js --port 8801',
    'node C:\\x\\node_modules\\@modelcontextprotocol\\server-filesystem\\dist\\index.js',
    'node C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
    'node C:\\Users\\a\\.vscode\\extensions\\ms-vscode.x\\server.js',
    'node C:\\p\\node_modules\\typescript\\lib\\tsserver.js',
    'node C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\resources\\app\\out\\bootstrap-fork --type=extensionHost',
    'node vscode-json-languageserver --node-ipc',
  ]) assert.strictEqual(dev({ commandLine }), false, commandLine);
});
t('system, docker, databases and model servers are skipped', () => {
  for (const processName of ['svchost.exe', 'System', 'com.docker.backend.exe', 'Docker Desktop.exe', 'redis-server.exe', 'qdrant.exe', 'postgres.exe', 'mongod.exe', 'nginx.exe', 'ollama.exe', 'whisper-server.exe']) {
    assert.strictEqual(dev({ processName }), false, processName);
  }
  assert.strictEqual(dev({ processName: 'python.exe', commandLine: 'python redis_proxy.py' }), false);
  assert.strictEqual(dev({ processName: 'python.exe', commandLine: 'python -m jupyter lab' }), false);
});
t('a project folder named like a service is still a dev server', () => {
  assert.strictEqual(dev({ commandLine: 'node D:\\work\\redis-dashboard\\node_modules\\next\\dist\\bin\\next dev' }), true);
});
t('privileged ports, other ports out of range and non-local binds are skipped', () => {
  assert.strictEqual(dev({ port: 80, address: '0.0.0.0:80' }), false);
  assert.strictEqual(dev({ port: 1023, address: '127.0.0.1:1023' }), false);
  assert.strictEqual(dev({ port: 70000 }), false);
  assert.strictEqual(dev({ address: '192.168.1.20:3000' }), false);
});
t('an unresolved process name is skipped', () => {
  assert.strictEqual(dev({ processName: 'Unknown' }), false);
  assert.strictEqual(dev({ processName: '' }), false);
  assert.strictEqual(classify(null).dev, false);
});
t('every refusal says why', () => {
  assert.ok(classify(item({ processName: 'brave.exe' })).reason.includes('brave'));
});

// ---- deriveProject ---------------------------------------------------------
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-detect-'));
const proj = path.join(base, 'shop-web');
fs.mkdirSync(path.join(proj, 'node_modules', 'next', 'dist', 'bin'), { recursive: true });
fs.mkdirSync(path.join(proj, 'node_modules', '.pnpm', 'next@14', 'node_modules', 'next', 'dist'), { recursive: true });
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'package.json'), '{}');
fs.writeFileSync(path.join(proj, 'src', 'server.js'), '');
const node = process.platform === 'win32' ? '"C:\\Program Files\\nodejs\\node.exe"' : '/usr/bin/node';

t('a bin under node_modules names the project folder before it', () => {
  const p = deriveProject(`${node} "${path.join(proj, 'node_modules', 'next', 'dist', 'bin', 'next')}" dev -p 3000`);
  assert.deepStrictEqual(p, { name: 'shop-web', cwd: proj, startCommand: null });
});
t('a pnpm store path resolves to the project, not the store', () => {
  const p = deriveProject(`${node} ${path.join(proj, 'node_modules', '.pnpm', 'next@14', 'node_modules', 'next', 'dist', 'server.js')}`);
  assert.strictEqual(p.cwd, proj);
});
t('a plain script walks up to the nearest package.json', () => {
  const p = deriveProject(`${node} ${path.join(proj, 'src', 'server.js')} --port 4000`);
  assert.strictEqual(p.cwd, proj);
  assert.strictEqual(p.name, 'shop-web');
});
t('a quoted path with spaces survives', () => {
  const spaced = path.join(base, 'my shop');
  fs.mkdirSync(path.join(spaced, 'node_modules', 'vite', 'bin'), { recursive: true });
  const p = deriveProject(`${node} "${path.join(spaced, 'node_modules', 'vite', 'bin', 'vite.js')}"`);
  assert.strictEqual(p.cwd, spaced);
});
t('no folder on the command line: no cwd, a readable name', () => {
  assert.deepStrictEqual(deriveProject('python -m http.server 3117'), { name: 'python http.server', cwd: null, startCommand: null });
  assert.deepStrictEqual(deriveProject('"C:\\Python312\\python.exe" -m http.server 3117'), { name: 'python http.server', cwd: null, startCommand: null });
  assert.deepStrictEqual(deriveProject('node server.js'), { name: 'node server.js', cwd: null, startCommand: null });
  assert.deepStrictEqual(deriveProject(''), { name: 'server', cwd: null, startCommand: null });
});
t('a globally installed tool is not a project', () => {
  const p = deriveProject('"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\http-server\\bin\\http-server -p 8080');
  assert.strictEqual(p.cwd, null);
  assert.strictEqual(p.name, 'node http-server');
});
t('a folder that does not exist is not returned as cwd', () => {
  const p = deriveProject(`${node} ${path.join(base, 'gone', 'node_modules', 'x', 'y.js')}`);
  assert.strictEqual(p.cwd, null);
});

// ---- detectedAppId ---------------------------------------------------------
t('detectedAppId is stable, short and port-specific', () => {
  const a = detectedAppId('D:\\work\\shop', 'shop', 3000);
  assert.match(a, /^det_[0-9a-f]{10}$/);
  assert.strictEqual(a, detectedAppId('D:\\work\\shop', 'shop', 3000));
  assert.notStrictEqual(a, detectedAppId('D:\\work\\shop', 'shop', 3001));
  assert.notStrictEqual(a, detectedAppId('D:\\work\\other', 'other', 3000));
});
t('detectedAppId ignores case and slashes where the file system does, and uses the name with no cwd', () => {
  assert.strictEqual(detectedAppId('D:\\Work\\Shop\\', 's', 3000, 'win32'), detectedAppId('d:/work/shop', 's', 3000, 'win32'));
  assert.notStrictEqual(detectedAppId('/a/Shop', 's', 3000, 'linux'), detectedAppId('/a/shop', 's', 3000, 'linux'));
  assert.notStrictEqual(detectedAppId(null, 'python http.server', 3117), detectedAppId(null, 'node server.js', 3117));
});

fs.rmSync(base, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
