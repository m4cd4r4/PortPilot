/**
 * MCP start provenance: stampStart records "claude" as the starter in
 * portpilot-runtime.json. Drives the pure helper exported from
 * mcp-server/index.js - no server, no processes.
 *
 * Run: node tests/mcp-provenance.test.mjs   (part of npm run test:mcp)
 */
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { stampStart } from '../mcp-server/index.js';

const require = createRequire(import.meta.url);
const { readRuntime } = require('../src/core/configFile.js');
const { provenanceOf } = require('../src/core/status.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.message); fail++; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-mcp-prov-'));
let n = 0;
const tmpConfig = () => {
  const dir = path.join(root, `case${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'portpilot-config.json');
};
const app = { id: 'app_web', name: 'Web', preferredPort: 5173 };

t('stamps kind claude, surface mcp, with the session id and port', () => {
  const cfg = tmpConfig();
  assert.equal(stampStart(cfg, app, 'a3f29b1c-0000'), true);
  const entry = readRuntime(cfg).apps.app_web;
  assert.equal(entry.startedBy.kind, 'claude');
  assert.equal(entry.startedBy.surface, 'mcp');
  assert.equal(entry.startedBy.sessionId, 'a3f29b1c-0000');
  assert.equal(entry.port, 5173);
  assert.equal(provenanceOf(entry.startedBy).word, 'claude a3f2');
});

t('stamps without a session id (reads as plain "claude")', () => {
  const cfg = tmpConfig();
  assert.equal(stampStart(cfg, app), true);
  const entry = readRuntime(cfg).apps.app_web;
  assert.equal(entry.startedBy.sessionId, undefined);
  assert.equal(provenanceOf(entry.startedBy).word, 'claude');
});

t('returns false for an app with no id', () => {
  assert.equal(stampStart(tmpConfig(), { name: 'nameless' }, 's1'), false);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
