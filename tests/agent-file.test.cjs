/**
 * agent.json survives a Windows force-terminate of the web agent (process.on('exit') never runs),
 * so readers must drop a record whose pid is dead. Run: node tests/agent-file.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readLiveAgent, writeAgent, removeAgent, agentFilePath } = require('../src/core/agentFile');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('OK ', name); passed++; }
  catch (e) { console.log('XX ', name, '-', e.message); failed++; }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pp-agent-'));

// A pid that is certainly dead: a child that has already exited.
const dead = spawnSync(process.execPath, ['-e', '0']).pid;

t('no file: null, and nothing is created', () => {
  const dir = tmp();
  assert.equal(readLiveAgent(dir), null);
  assert.equal(fs.existsSync(agentFilePath(dir)), false);
});

t('a live pid is returned as written', () => {
  const dir = tmp();
  writeAgent(dir, { port: 7319, token: 'abc' });
  const info = readLiveAgent(dir);
  assert.equal(info.port, 7319);
  assert.equal(info.token, 'abc');
  assert.equal(info.pid, process.pid);
});

t('a dead pid is stale: null, and the file is deleted', () => {
  const dir = tmp();
  writeAgent(dir, { port: 7319, token: 'abc', pid: dead });
  assert.equal(readLiveAgent(dir), null);
  assert.equal(fs.existsSync(agentFilePath(dir)), false);
});

t('a corrupt file is deleted', () => {
  const dir = tmp();
  fs.writeFileSync(agentFilePath(dir), '{not json');
  assert.equal(readLiveAgent(dir), null);
  assert.equal(fs.existsSync(agentFilePath(dir)), false);
});

t('removeAgent leaves another live agent\'s record alone', () => {
  const dir = tmp();
  writeAgent(dir, { port: 7319, token: 'abc', pid: process.pid + 100000 });
  assert.equal(removeAgent(dir), false);
  assert.ok(fs.existsSync(agentFilePath(dir)));
  assert.equal(removeAgent(dir, process.pid + 100000), true);
  assert.equal(fs.existsSync(agentFilePath(dir)), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
