/**
 * parseTasklistCsv (src/main/portScanner.js): the Windows fallback that
 * replaced `wmic` for PID -> image name / memory lookups.
 * Run: node tests/tasklist-parse.test.cjs   (part of npm run test:unit)
 *
 * Pure parsing against captured output. On Windows it also parses a live
 * `tasklist` run and checks this process is found.
 */
const assert = require('assert');
const os = require('os');
const { execSync } = require('child_process');
const { parseTasklistCsv } = require('../src/main/portScanner');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

const SAMPLE = [
  '"System Idle Process","0","Services","0","8 K"',
  '"node.exe","4242","Console","1","123,456 K"',
  '"Code - Insiders.exe","777","Console","1","1.048.576 K"',
  '"python.exe","31337","Console","1","2 048 K"',
  '',
  'INFO: No tasks are running which match the specified criteria.',
].join('\r\n');

t('parses name and memory for every row', () => {
  const m = parseTasklistCsv(SAMPLE);
  assert.equal(m.size, 4);
  assert.deepEqual(m.get(4242), { name: 'node.exe', memoryKb: 123456 });
});
t('memory ignores locale separators (comma, dot, space)', () => {
  const m = parseTasklistCsv(SAMPLE);
  assert.equal(m.get(777).memoryKb, 1048576);
  assert.equal(m.get(31337).memoryKb, 2048);
});
t('image names with spaces and dashes survive', () => {
  assert.equal(parseTasklistCsv(SAMPLE).get(777).name, 'Code - Insiders.exe');
});
t('wantedPids filters the result', () => {
  const m = parseTasklistCsv(SAMPLE, [4242, 999]);
  assert.deepEqual([...m.keys()], [4242]);
});
t('INFO line, blank and garbage input give an empty map', () => {
  assert.equal(parseTasklistCsv('INFO: No tasks are running which match the specified criteria.').size, 0);
  assert.equal(parseTasklistCsv('').size, 0);
  assert.equal(parseTasklistCsv(undefined).size, 0);
});
t('a row without the memory column still yields a name', () => {
  assert.deepEqual(parseTasklistCsv('"svc.exe","12"').get(12), { name: 'svc.exe', memoryKb: null });
});

if (os.platform() === 'win32') {
  t('live tasklist output finds this node process', () => {
    const out = execSync(`tasklist /fo csv /nh /fi "PID eq ${process.pid}"`, { encoding: 'utf8', windowsHide: true });
    const info = parseTasklistCsv(out, [process.pid]).get(process.pid);
    assert.ok(info, 'own pid not found');
    assert.match(info.name, /node|electron/i);
    assert.ok(info.memoryKb > 1024, `implausible memory ${info.memoryKb} KB`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
