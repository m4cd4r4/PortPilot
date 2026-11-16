/**
 * A start whose port opens after start_app's verify window still gets a run.
 * Case (2026-11-15): kids-arcade-kings-park ran `npx --yes http-server ...`; npx spent its first
 * run downloading, start_app reported "port 4181 never came up within ~6s", the server came up
 * seconds later and served all evening, but History and find_run never listed it - the run was
 * opened only on a start verified inside the window.
 *
 * Spawns a real node server that listens after the (shortened) verify window.
 * Run: node tests/mcp-slow-start.test.mjs   (part of npm run test:mcp)
 */
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { startAndRecord, checkPort } from '../mcp-server/index.js';

const require = createRequire(import.meta.url);
const { readRuns } = require('../src/core/runHistory.js');
const { readRuntime } = require('../src/core/configFile.js');

const PORT = 4996; // not 4180 / 4181 (claimed by real apps on this machine)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-slow-start-'));
const cfg = path.join(root, 'portpilot-config.json');
const app = {
  id: 'app_slow', name: 'slow', cwd: root, preferredPort: PORT,
  command: 'node slow-server.js',
};
// A file, not node -e: the detached start wraps the command in cmd /c "...", which inner quotes break.
fs.writeFileSync(path.join(root, 'slow-server.js'),
  `setTimeout(() => require('http').createServer((q, r) => r.end('ok')).listen(${PORT}), 6000);`);
fs.writeFileSync(cfg, JSON.stringify({ apps: [app] }));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.stack || e.message); fail++; }
}

assert.ok(!checkPort(PORT),`port ${PORT} must be free for this test`);

await t('a start that misses the verify window is recorded once its port opens', async () => {
  const result = await startAndRecord(cfg, app, { sessionId: 'a3f29b1c-0000', verifyTries: 1, lateWindowMs: 20000 });
  assert.equal(result.success, false);
  assert.equal(readRuns(cfg).length, 0, 'no run before the port is up');
  for (let i = 0; i < 40 && !readRuns(cfg).length; i++) await wait(500);
  const runs = readRuns(cfg);
  assert.equal(runs.length, 1, 'one run once the port opened; port up=' + !!checkPort(PORT) + ' runtime=' + JSON.stringify(readRuntime(cfg).apps));
  assert.equal(runs[0].appId, 'app_slow');
  assert.equal(runs[0].startedBy.sessionId, 'a3f29b1c-0000');
  assert.ok(readRuntime(cfg).apps.app_slow, 'runtime stamp written too');
});

// Leave nothing listening on the test port.
try {
  const { execSync } = await import('node:child_process');
  if (process.platform === 'win32') {
    const out = execSync(`netstat -ano -p tcp | findstr :${PORT}`, { encoding: 'utf8' });
    for (const pid of new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p) && p !== '0'))) {
      try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ }
    }
  } else {
    execSync(`kill $(lsof -t -i:${PORT}) 2>/dev/null || true`);
  }
} catch { /* nothing listening */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
