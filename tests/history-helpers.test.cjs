/**
 * isLoopbackUrl (thumbnail capture never leaves localhost) and pickPort (Re-run port choice).
 * Run: node tests/history-helpers.test.cjs   (part of npm run test:unit)
 * tdd-guard:allow  (backfilled onto already-written code)
 */
const assert = require('assert');
const path = require('path');
const { isLoopbackUrl } = require('../src/main/thumbnails');
const { pickPort } = require('../src/main/rerun');

async function main() {
  for (const url of ['http://localhost:3000/', 'http://127.0.0.1:5173/x?y=1', 'https://localhost/', 'http://[::1]:8080/']) {
    assert.strictEqual(isLoopbackUrl(url), true, url);
  }
  for (const url of ['http://example.com/', 'http://localhost.evil.com/', 'http://127.0.0.1.evil.com/', 'file:///etc/passwd',
    'javascript:alert(1)', 'http://192.168.1.5:3000/', 'not a url', '', undefined]) {
    assert.strictEqual(isLoopbackUrl(url), false, String(url));
  }

  // pickPort: skips ports registered apps claim, gives up cleanly.
  const free = async (from) => from; // everything is free on the machine
  assert.strictEqual(await pickPort(4000, new Set(), free), 4000, 'free port taken as is');
  assert.strictEqual(await pickPort(4000, new Set([4000, 4001]), free), 4002, 'skips claimed ports');
  assert.strictEqual(await pickPort(4000, new Set(), async () => null), null, 'null when nothing is free');
  const allClaimed = { has: () => true };
  assert.strictEqual(await pickPort(4000, allClaimed, free), null, 'bounded search');

  // Port rewrite: per segment, so another tool's -p is left alone.
  const { rewritePort, validateRecord } = require('../src/core/rerun');
  assert.deepStrictEqual(rewritePort('next dev --port  3000', 4100), { command: 'next dev --port  4100', rewritten: true });
  assert.strictEqual(rewritePort('docker run -p 5432:5432 db && next dev -p 3000', 4100).command, 'docker run -p 5432:5432 db && next dev -p 4100');
  assert.strictEqual(rewritePort('npm run dev', 4100).rewritten, false);

  // Record validation: values that reach git and the filesystem.
  const good = { id: 'r_20261009T052538_c78487da', repoRoot: path.resolve('/repo/shop'), relCwd: 'apps/web', command: 'npm run dev',
    git: { sha: 'a'.repeat(40), snapshot: { ref: 'refs/portpilot/runs/r_20261009T052538_c78487da', commit: 'b'.repeat(40) } } };
  assert.strictEqual(validateRecord(good), null);
  for (const bad of [
    { ...good, git: { ...good.git, sha: '--hard' } },
    { ...good, git: { sha: good.git.sha, snapshot: { ref: 'refs/heads/main', commit: null } } },
    { ...good, relCwd: '../../etc' },
    { ...good, relCwd: path.resolve('/etc') },
    { ...good, command: null },
    { ...good, repoRoot: 'relative/repo' },
    { ...good, id: 'r_x/../y' },
  ]) assert.strictEqual(validateRecord(bad).code, 'bad-record', JSON.stringify(bad).slice(0, 80));

  // Sweep: an unreadable runs.json must delete nothing (an empty list would make every thumb an orphan).
  const fs = require('fs');
  const os = require('os');
  const { sweep } = require('../src/core/runSweep');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sweep-'));
  const cfgPath = path.join(dir, 'portpilot-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ apps: [], settings: {} }));
  fs.mkdirSync(path.join(dir, 'history', 'thumbs'), { recursive: true });
  const thumb = path.join(dir, 'history', 'thumbs', 'r_old.jpg');
  fs.writeFileSync(thumb, 'x');
  fs.utimesSync(thumb, new Date(0), new Date(0));
  fs.writeFileSync(path.join(dir, 'history', 'runs.json'), '{ not json');
  await assert.rejects(sweep(cfgPath), 'unreadable runs.json aborts the sweep');
  assert(fs.existsSync(thumb), 'thumb survives a corrupt runs.json');
  fs.writeFileSync(path.join(dir, 'history', 'runs.json'), JSON.stringify({ runs: [] }));
  assert.deepStrictEqual(await sweep(cfgPath), { thumbs: 0, refs: 0 });
  assert(fs.existsSync(thumb), 'thumb survives an empty history');
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('history helpers: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
