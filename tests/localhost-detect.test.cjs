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

// ---- a relative script: which folder holds it ------------------------------
const rel = require('../src/core/localhostDetect');
const relBase = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-rel-'));
const folder = (name, files = ['server.js'], mtimeSecondsAgo = 0) => {
  const d = path.join(relBase, name);
  fs.mkdirSync(d, { recursive: true });
  for (const f of files) {
    const p = path.join(d, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '// x');
    const at = new Date(Date.now() - mtimeSecondsAgo * 1000);
    fs.utimesSync(p, at, at);
  }
  return d;
};
const NODE_CMD = '"C:\\Program Files\\nodejs\\node.exe" server.js --port 3117';

t('relativeTargets: node/python scripts, python -m modules, php -S, and nothing for absolute or flag-only lines', () => {
  assert.deepStrictEqual(rel.relativeTargets(NODE_CMD), ['server.js']);
  assert.deepStrictEqual(rel.relativeTargets('python3 -u ./app.py 8000'), ['./app.py']);
  assert.deepStrictEqual(rel.relativeTargets('python -m myapp.web --port 8000'), ['myapp/web.py', 'myapp/web/__main__.py']);
  assert.deepStrictEqual(rel.relativeTargets('php -S localhost:8000 router.php'), ['router.php']);
  assert.deepStrictEqual(rel.relativeTargets('php -S localhost:8000 -t public'), ['public/index.php', 'public/index.html', 'public/index.htm']);
  assert.deepStrictEqual(rel.relativeTargets('php -S localhost:8000'), ['index.php', 'index.html', 'index.htm']);
  assert.strictEqual(rel.relativeTargets('node C:\\work\\shop\\server.js'), null);
  assert.strictEqual(rel.relativeTargets('node --inspect'), null);
  assert.strictEqual(rel.relativeTargets('python -m http.server 3117').length, 2, 'a module is looked for as a file like any other');
});

t('a relative script is found in a folder that holds it: name is the folder, cwd is the folder', () => {
  const d = folder('shop-api');
  const p = rel.deriveProject(NODE_CMD, { candidates: [[d]] });
  assert.strictEqual(p.cwd, d);
  assert.strictEqual(p.name, 'shop-api');
  assert.strictEqual(p.relative, true);
  assert.strictEqual(p.startCommand, null);
});

t('without candidates, or when no candidate holds the file, a relative script stays unresolved (name from the command)', () => {
  const d = folder('no-file', ['other.js']);
  for (const opts of [undefined, {}, { candidates: [] }, { candidates: [[d]] }, { candidates: [[path.join(relBase, 'gone')]] }]) {
    const p = rel.deriveProject(NODE_CMD, opts);
    assert.strictEqual(p.cwd, null);
    assert.strictEqual(p.name, 'node server.js');
    assert.ok(!p.relative);
  }
});

t('an absolute script is left alone: the candidates are never consulted', () => {
  const d = folder('absolute-wins');
  const decoy = folder('decoy');
  const p = rel.deriveProject(`node ${path.join(d, 'server.js')} --port 3117`, { candidates: [[decoy]] });
  assert.strictEqual(p.cwd, d);
  assert.ok(!p.relative);
});

t('resolveRelative: the first group holding the file decides, later groups are not consulted', () => {
  const live = folder('g-live');
  const app = folder('g-app', ['server.js'], 3600);
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[live], [app]]).cwd, live);
  const empty = folder('g-empty', ['x.js']);
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[empty], [app]]).cwd, app);
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[empty], [], [app]]).cwd, app, 'a later group is found when the earlier ones miss');
});

t('resolveRelative: two folders holding the file are told apart by mtime only past a minute, else null', () => {
  const fresh = folder('m-fresh', ['server.js'], 0);
  const old = folder('m-old', ['server.js'], 600);
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[old, fresh]]).cwd, fresh, 'newer by 10 minutes wins whatever the order');
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[fresh, old]]).cwd, fresh);
  const close = folder('m-close', ['server.js'], 30);
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[fresh, close]]), null, '30 s apart is a tie');
  const same = folder('m-same', ['server.js'], 0);
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[fresh, same]]), null);
  assert.strictEqual(rel.resolveRelative(NODE_CMD, [[fresh, close], [old]]), null, 'a tie is not a miss: later groups are not tried');
  assert.strictEqual(rel.deriveProject(NODE_CMD, { candidates: [[fresh, close]] }).cwd, null);
});

t('resolveRelative: the same folder listed twice (any case or trailing slash) is one candidate, not an ambiguity', () => {
  const d = folder('dupes');
  const r = rel.resolveRelative(NODE_CMD, [[d, d + path.sep, d.toUpperCase()]]);
  assert.ok(r && r.cwd === d);
});

t('resolveRelative: injected fs seams drive the decision', () => {
  const seen = [];
  const isFile = (p) => { seen.push(p); return p === path.join('/work/a', 'src', 'app.py'); };
  const r = rel.resolveRelative('python src/app.py', [['/work/b', '/work/a']], { isFile, mtimeMs: () => 0 });
  assert.strictEqual(r.cwd, '/work/a');
  assert.strictEqual(seen.length, 2);
});

t('resolveRelative: python -m finds a module file or package, php -S finds its index or router', () => {
  const py = folder('py', ['myapp/web.py']);
  assert.strictEqual(rel.resolveRelative('python -m myapp.web', [[py]]).cwd, py);
  const pkg = folder('pypkg', ['myapp/web/__main__.py']);
  assert.strictEqual(rel.resolveRelative('python -m myapp.web', [[pkg]]).cwd, pkg);
  assert.strictEqual(rel.resolveRelative('python -m http.server 3117', [[py, pkg]]), null, 'a stdlib module is in no project folder');
  const php = folder('php', ['public/index.php']);
  assert.strictEqual(rel.resolveRelative('php -S localhost:8000 -t public', [[php]]).cwd, php);
  assert.strictEqual(rel.resolveRelative('php -S localhost:8000', [[php]]), null, 'no index at the folder root');
  const site = folder('site', ['index.html']);
  assert.strictEqual(rel.resolveRelative('php -S localhost:8000', [[site]]).cwd, site);
});

t('candidateFolders: live sessions add their git root and two parents; apps and runs are taken as they are; gone folders drop', () => {
  const top = folder('repo', ['.git/HEAD']);
  const deep = path.join(top, 'packages', 'api');
  fs.mkdirSync(deep, { recursive: true });
  const app = folder('registered', []);
  const old = folder('recent', []);
  const [sessions, apps, runs] = rel.candidateFolders({
    sessionCwds: [deep, path.join(relBase, 'vanished')],
    appCwds: [app, null, ''],
    runCwds: [old],
  });
  assert.deepStrictEqual(sessions.slice(0, 2), [deep, top], 'cwd first, then the git root');
  assert.ok(sessions.includes(path.join(top, 'packages')), 'the parent');
  assert.ok(!sessions.includes(path.join(relBase, 'vanished')));
  assert.deepStrictEqual(apps, [app]);
  assert.deepStrictEqual(runs, [old]);
  assert.deepStrictEqual(rel.candidateFolders(), [[], [], []]);
});

t('candidateFolders feeds resolveRelative: a script one level above a session folder is found, and the session wins over an app', () => {
  const top = folder('mono', ['server.js']);
  const sub = path.join(top, 'docs');
  fs.mkdirSync(sub, { recursive: true });
  const app = folder('other-app', ['server.js'], 3600);
  const groups = rel.candidateFolders({ sessionCwds: [sub], appCwds: [app] });
  assert.strictEqual(rel.resolveRelative(NODE_CMD, groups).cwd, top);
});

fs.rmSync(relBase, { recursive: true, force: true });

fs.rmSync(base, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
