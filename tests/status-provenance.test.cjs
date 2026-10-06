/**
 * Status provenance (src/core/status.js + the runtime-state helpers in
 * src/core/configFile.js).
 * Run: node tests/status-provenance.test.cjs   (part of npm run test:unit)
 *
 * Covers: makeStartedBy validation, the words provenanceOf shows, crashed
 * precedence, docs/ui-redesign/STATUS-VOCABULARY.md matching STATES, and
 * recordStart / recordStop / readRuntime against a temp config dir.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const status = require('../src/core/status');
const { recordStart, recordStop, readRuntime, runtimePathFor } = require('../src/core/configFile');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-provenance-'));
let n = 0;
const tmpConfig = () => {
  const dir = path.join(root, `case${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'portpilot-config.json');
};

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

// ---- makeStartedBy ----
t('makeStartedBy builds a record with a timestamp', () => {
  const s = status.makeStartedBy({ kind: 'claude', surface: 'mcp', sessionId: 'a3f2-9b1c' });
  assert.equal(s.kind, 'claude');
  assert.equal(s.surface, 'mcp');
  assert.equal(s.sessionId, 'a3f2-9b1c');
  assert.ok(!Number.isNaN(Date.parse(s.at)));
});
t('makeStartedBy omits empty optional fields', () => {
  const s = status.makeStartedBy({ kind: 'human', surface: 'desktop' });
  assert.deepEqual(Object.keys(s).sort(), ['at', 'kind', 'surface']);
});
t('makeStartedBy rejects an unknown kind', () => {
  assert.throws(() => status.makeStartedBy({ kind: 'robot', surface: 'mcp' }), /kind/);
});
t('makeStartedBy rejects an unknown surface', () => {
  assert.throws(() => status.makeStartedBy({ kind: 'human', surface: 'fax' }), /surface/);
});
t('makeStartedBy caps sessionId and label length', () => {
  const s = status.makeStartedBy({ kind: 'claude', surface: 'mcp', sessionId: 'x'.repeat(500), label: 'y'.repeat(500) });
  assert.equal(s.sessionId.length, 200);
  assert.equal(s.label.length, 100);
});

// ---- provenanceOf ----
t('provenanceOf: human reads "you" with no glyph', () => {
  const p = status.provenanceOf(status.makeStartedBy({ kind: 'human', surface: 'vscode' }));
  assert.equal(p.word, 'you');
  assert.equal(p.glyph, '');
  assert.match(p.title, /vscode/);
});
t('provenanceOf: claude reads "claude <4 chars>" with the glyph', () => {
  const p = status.provenanceOf({ kind: 'claude', surface: 'mcp', sessionId: 'A3-F2b9c1' });
  assert.equal(p.word, 'claude a3f2');
  assert.equal(p.glyph, status.CLAUDE_GLYPH);
  assert.match(p.title, /A3-F2b9c1/);
});
t('provenanceOf: claude with no session reads "claude"', () => {
  assert.equal(status.provenanceOf({ kind: 'claude', surface: 'mcp' }).word, 'claude');
});
t('provenanceOf: no record or unknown kind reads "external"', () => {
  assert.equal(status.provenanceOf(null).word, 'external');
  assert.equal(status.provenanceOf({ kind: 'alien' }).word, 'external');
});

// ---- crashed state ----
t('crashed outranks error and everything below it', () => {
  assert.equal(status.statusOf({ crashed: true, error: true, conflict: true, running: true }).state, 'crashed');
  assert.equal(status.statusOf({ error: true, conflict: true }).state, 'error');
});
t('every state has a distinct glyph and ascii fallback', () => {
  const states = Object.values(status.STATES);
  assert.equal(new Set(states.map(s => s.glyph)).size, states.length);
  assert.equal(new Set(states.map(s => s.ascii)).size, states.length);
});

// ---- doc stays in step with STATES ----
t('STATUS-VOCABULARY.md state table matches STATES', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui-redesign', 'STATUS-VOCABULARY.md'), 'utf8');
  const rows = {};
  for (const line of doc.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([a-z]+)`\s*\|\s*(\S+)\s*\|\s*`(\S+)`\s*\|\s*(\w+)\s*\|\s*`(--status-[a-z]+)`\s*\|/);
    if (m) rows[m[1]] = { glyph: m[2], ascii: m[3], label: m[4], token: m[5] };
  }
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(status.STATES).sort());
  for (const [key, s] of Object.entries(status.STATES)) {
    assert.deepEqual(rows[key], { glyph: s.glyph, ascii: s.ascii, label: s.label, token: s.token }, `row ${key}`);
  }
});

// ---- runtime-state file ----
t('recordStart writes portpilot-runtime.json beside the config', () => {
  const cfg = tmpConfig();
  const by = status.makeStartedBy({ kind: 'claude', surface: 'mcp', sessionId: 'abcd1234' });
  assert.equal(recordStart(cfg, 'app_1', by, { pid: 4242, port: 3000 }), true);
  assert.equal(path.dirname(runtimePathFor(cfg)), path.dirname(cfg));
  const rt = readRuntime(cfg);
  assert.deepEqual(rt.apps.app_1, { startedBy: by, pid: 4242, port: 3000 });
  assert.ok(!fs.existsSync(cfg), 'config file itself is untouched');
});
t('recordStart overwrites the previous starter; other apps survive', () => {
  const cfg = tmpConfig();
  recordStart(cfg, 'app_1', status.makeStartedBy({ kind: 'human', surface: 'desktop' }));
  recordStart(cfg, 'app_2', status.makeStartedBy({ kind: 'human', surface: 'web' }));
  recordStart(cfg, 'app_1', status.makeStartedBy({ kind: 'claude', surface: 'mcp' }));
  const rt = readRuntime(cfg);
  assert.equal(rt.apps.app_1.startedBy.kind, 'claude');
  assert.equal(rt.apps.app_2.startedBy.surface, 'web');
});
t('recordStop removes only that app', () => {
  const cfg = tmpConfig();
  recordStart(cfg, 'app_1', status.makeStartedBy({ kind: 'human', surface: 'desktop' }));
  recordStart(cfg, 'app_2', status.makeStartedBy({ kind: 'human', surface: 'desktop' }));
  assert.equal(recordStop(cfg, 'app_1'), true);
  assert.deepEqual(Object.keys(readRuntime(cfg).apps), ['app_2']);
  assert.equal(recordStop(cfg, 'never_started'), true);
});
t('readRuntime tolerates a missing or malformed file', () => {
  const cfg = tmpConfig();
  assert.deepEqual(readRuntime(cfg), { apps: {} });
  fs.writeFileSync(runtimePathFor(cfg), JSON.stringify({ apps: 'nope' }));
  assert.deepEqual(readRuntime(cfg).apps, {});
});
t('recordStart returns false instead of throwing when the write fails', () => {
  // Parent "directory" is a regular file, so the write cannot succeed.
  const blocker = path.join(root, 'not-a-dir');
  fs.writeFileSync(blocker, '');
  const cfg = path.join(blocker, 'portpilot-config.json');
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal(recordStart(cfg, 'app_1', status.makeStartedBy({ kind: 'human', surface: 'desktop' })), false);
    assert.equal(recordStop(cfg, 'app_1'), false);
  } finally {
    console.error = origError;
  }
});
t('recordStart refuses a missing appId or startedBy', () => {
  const cfg = tmpConfig();
  assert.equal(recordStart(cfg, '', status.makeStartedBy({ kind: 'human', surface: 'desktop' })), false);
  assert.equal(recordStart(cfg, 'app_1', null), false);
  assert.ok(!fs.existsSync(runtimePathFor(cfg)));
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
