/**
 * MCP-started apps log their output: detachedCommand sends stdout and stderr
 * to logs/<appId>.log, so a crash alert has a tail to show. The last case
 * runs the real shell line on this platform and reads the log back.
 *
 * Run: node tests/mcp-crash-log.test.mjs   (part of npm run test:mcp)
 */
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import { detachedCommand, prepareLog } from '../mcp-server/index.js';

const require = createRequire(import.meta.url);
const { logPathFor, readLogTail } = require('../src/core/configFile.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.message); fail++; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-crash-log-'));
const cfg = path.join(root, 'portpilot-config.json');

await t('win32: output and errors go to the quoted log', () => {
  assert.equal(
    detachedCommand('win32', 'npm run dev', 'C:\\x y\\logs\\web.log'),
    'start /B cmd /c "npm run dev > "C:\\x y\\logs\\web.log" 2>&1"');
});
await t('win32: no log discards output, as before', () => {
  assert.equal(detachedCommand('win32', 'npm run dev', null), 'start /B cmd /c "npm run dev > NUL 2>&1"');
});
await t('posix: the whole line runs under sh -c, quotes escaped', () => {
  assert.equal(
    detachedCommand('linux', "cd a && echo 'hi'", '/c/logs/web.log'),
    `nohup sh -c 'cd a && echo '\\''hi'\\''' > '/c/logs/web.log' 2>&1 &`);
});
await t('posix: no log discards output', () => {
  assert.equal(detachedCommand('darwin', 'npm start', null), `nohup sh -c 'npm start' > /dev/null 2>&1 &`);
});

await t('prepareLog creates the logs folder and truncates a previous run', () => {
  const log = logPathFor(cfg, 'web');
  assert.equal(path.dirname(log), path.join(root, 'logs'));
  assert.equal(prepareLog(log), log);
  fs.writeFileSync(log, 'old run');
  assert.equal(prepareLog(log), log);
  assert.equal(fs.readFileSync(log, 'utf8'), '');
});
await t('prepareLog returns null when the file cannot be opened', () => {
  const dir = path.join(root, 'is-a-dir.log');
  fs.mkdirSync(dir);
  assert.equal(prepareLog(dir), null);
  assert.equal(prepareLog(null), null);
});

await t('a real detached start writes stdout and stderr to the log', async () => {
  const log = prepareLog(logPathFor(cfg, 'crashy'));
  const cmd = 'node -e "console.log(\'booting\'); console.error(\'EADDRINUSE boom\'); process.exit(1)"';
  exec(detachedCommand(os.platform(), cmd, log), { cwd: root, shell: true, windowsHide: true });
  let tail = '';
  for (let i = 0; i < 50 && !/boom/.test(tail); i++) {
    await new Promise((r) => setTimeout(r, 200));
    tail = readLogTail(cfg, 'crashy') || '';
  }
  assert.match(tail, /booting/);
  assert.match(tail, /EADDRINUSE boom/);
});

try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* a detached child may still hold it */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
