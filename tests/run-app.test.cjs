/**
 * appForRun (src/core/runApp.js): registers or reuses an app for a recorded run.
 * Run: node tests/run-app.test.cjs   (part of npm run test:unit)
 * Temp config dirs only; never the real PortPilot config.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { appForRun } = require('../src/core/runApp');
const configFile = require('../src/core/configFile');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-runapp-'));
let n = 0;
let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

function setup(apps = []) {
  const dir = path.join(root, `case${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'portpilot-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ apps, settings: {}, groups: [] }));
  const project = path.join(dir, 'shop-web');
  fs.mkdirSync(project);
  return { configPath, project };
}
const appsOf = (configPath) => configFile.readJson(configPath, () => ({ apps: [] })).apps;

t('adds an app for a closed detected run', () => {
  const s = setup();
  const r = appForRun(s.configPath, { appName: 'shop-web', cwd: s.project, startCommand: 'npm run dev', port: 3111 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.port, 3111);
  const apps = appsOf(s.configPath);
  assert.strictEqual(apps.length, 1);
  assert.strictEqual(apps[0].id, r.appId);
  assert.strictEqual(apps[0].command, 'npm run dev');
  assert.strictEqual(apps[0].cwd, s.project);
  assert.strictEqual(apps[0].preferredPort, 3111);
  assert.strictEqual(apps[0].name, 'shop-web');
});

t('reuses an app already registered for the same folder (slash and case insensitive)', () => {
  const s = setup([{ id: 'app_x', name: 'Mine', command: 'pnpm dev', cwd: '', preferredPort: 4000 }]);
  const cfg = configFile.readJson(s.configPath, () => ({}));
  // Folder names are case-sensitive on Linux, so only the slash form is varied there.
  const slashed = s.project.replace(/\\/g, '/');
  cfg.apps[0].cwd = process.platform === 'linux' ? slashed : slashed.toUpperCase();
  fs.writeFileSync(s.configPath, JSON.stringify(cfg));
  const r = appForRun(s.configPath, { appName: 'shop-web', cwd: s.project, startCommand: 'npm run dev', port: 3111 });
  assert.deepStrictEqual({ ok: r.ok, appId: r.appId, port: r.port }, { ok: true, appId: 'app_x', port: 4000 });
  assert.strictEqual(appsOf(s.configPath).length, 1);
});

t('a second call does not add a duplicate', () => {
  const s = setup();
  const run = { appName: 'shop-web', cwd: s.project, startCommand: 'npm run dev', port: 3111 };
  const a = appForRun(s.configPath, run);
  const b = appForRun(s.configPath, run);
  assert.strictEqual(a.appId, b.appId);
  assert.strictEqual(appsOf(s.configPath).length, 1);
});

t('falls back to the run command, names the app after the folder', () => {
  const s = setup();
  const r = appForRun(s.configPath, { cwd: s.project, command: 'node server.js', port: 3112 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(appsOf(s.configPath)[0].name, 'shop-web');
  assert.strictEqual(appsOf(s.configPath)[0].command, 'node server.js');
});

t('refuses a run with no folder, a missing folder or no command', () => {
  const s = setup();
  for (const run of [
    null,
    { startCommand: 'npm run dev', port: 3000 },
    { cwd: path.join(s.project, 'gone'), startCommand: 'npm run dev', port: 3000 },
    { cwd: s.project, port: 3000 },
  ]) {
    const r = appForRun(s.configPath, run);
    assert.strictEqual(r.ok, false);
    assert.ok(r.error && typeof r.error === 'string');
  }
  assert.strictEqual(appsOf(s.configPath).length, 0);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
