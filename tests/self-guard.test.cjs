/**
 * PortPilot never matches itself to an app, never matches a cwd to a longer path, never kills itself,
 * and "Open folder" resolves a real directory. (src/core/selfGuard.js, src/core/openFolder.js,
 * the desktop matcher and the kill path.)
 * Run: node tests/self-guard.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');

const guard = require('../src/core/selfGuard');
const { folderToOpen } = require('../src/core/openFolder');
const { matchPortsToApps } = require('../src/main/ipcHandlers');
const { killProcess, killByPort } = require('../src/main/processManager');

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('OK ', name); passed++; }
  catch (e) { console.log('XX ', name, '-', e.message); failed++; }
}

const PACKAGED_MCP = '"C:\\Users\\me\\AppData\\Local\\Programs\\PortPilot\\PortPilot.exe" C:\\Users\\me\\AppData\\Local\\Programs\\PortPilot\\resources\\mcp-server\\index.js --port 8788';
const DEV_MCP = '"I:\\Scratch\\PortPilot-2026\\node_modules\\electron\\dist\\electron.exe" I:\\Scratch\\PortPilot-2026\\mcp-server\\index.js --port 8788';

(async () => {
  console.log('\n=== self guard ===\n');

  // ---- cmdNamesPath --------------------------------------------------------
  await t('a cwd is found in a command line under either slash style', () => {
    assert.ok(guard.cmdNamesPath('node I:\\Scratch\\app\\server.js', 'I:/Scratch/app'));
    assert.ok(guard.cmdNamesPath('node I:/Scratch/app/server.js', 'I:\\Scratch\\app\\'));
    assert.ok(guard.cmdNamesPath('next dev --cwd="i:/scratch/app"', 'I:/Scratch/app'));
    assert.ok(guard.cmdNamesPath('node I:\\Scratch\\app', 'I:/Scratch/app'));
  });
  await t('a cwd does not match a longer path that merely starts with it', () => {
    assert.equal(guard.cmdNamesPath('node I:\\Scratch\\app-worktree\\server.js', 'I:/Scratch/app'), false);
    assert.equal(guard.cmdNamesPath('node I:/Scratch/app2/server.js', 'I:/Scratch/app'), false);
    assert.equal(guard.cmdNamesPath('node /srv/home/u/app/s.js', '/home/u/app'), false);
  });
  await t('a cwd is found next to shell punctuation on a POSIX command line', () => {
    assert.ok(guard.cmdNamesPath('sh -c "cd /x/app;npm run dev"', '/x/app'));
    assert.ok(guard.cmdNamesPath('sh -c "(cd /x/app) && node s.js"', '/x/app'));
    assert.ok(guard.cmdNamesPath('PYTHONPATH=/x/app:/y python app.py', '/x/app'));
    assert.ok(guard.cmdNamesPath('node s.js --dirs=/y,/x/app,/z', '/x/app'));
  });
  await t('a folder name is found only as a whole path segment', () => {
    assert.ok(guard.cmdNamesFolder('node I:\\x\\app\\server.js', 'app'));
    assert.ok(guard.cmdNamesFolder('node i:/x/app', 'app'));
    assert.equal(guard.cmdNamesFolder('node I:\\x\\app-worktree\\server.js', 'app'), false);
    assert.equal(guard.cmdNamesFolder('node I:\\x\\myapp\\server.js', 'app'), false);
  });

  // ---- own servers ---------------------------------------------------------
  await t('the forked MCP server is recognised, packaged and in dev', () => {
    assert.ok(guard.isOwnServerCommand(PACKAGED_MCP));
    assert.ok(guard.isOwnServerCommand(DEV_MCP));
    assert.ok(guard.isOwnProcessName('PortPilot.exe'));
    assert.equal(guard.isOwnServerCommand('node I:\\work\\shop\\server.js --port 3000'), false);
    assert.equal(guard.isOwnProcessName('node.exe'), false);
  });
  await t('a user project that has "portpilot" elsewhere on the line is not an own server', () => {
    assert.equal(guard.isOwnServerCommand('node I:\\work\\portpilot-notes\\mcp-server\\index.js'), true, 'a PortPilot-named checkout is one');
    assert.equal(guard.isOwnServerCommand('node I:\\work\\shop\\mcp-server\\index.js --tag portpilot'), false);
    assert.equal(guard.isOwnServerCommand('node I:\\work\\portpilot-tools\\lib\\x\\mcp-server\\index.js'), false, 'portpilot must be the folder right above mcp-server');
  });
  await t('the registered web agent (npm run agent from the repo) is NOT an own server: it is the self-entry app', () => {
    assert.equal(guard.isOwnServerCommand('node I:\\Scratch\\PortPilot-2026\\src\\agent\\server.js'), false);
  });
  await t('this process is an own pid; protect/unprotect manage children', () => {
    assert.ok(guard.isOwnPid(process.pid));
    guard.protectPid(424242);
    assert.ok(guard.isOwnPid(424242));
    guard.unprotectPid(424242);
    assert.equal(guard.isOwnPid(424242), false);
    guard.unprotectPid(process.pid);
    assert.ok(guard.isOwnPid(process.pid), 'own pid cannot be unprotected');
  });

  // ---- desktop matcher -----------------------------------------------------
  const self = { id: 'pp', name: 'PortPilot', cwd: 'I:/Scratch/PortPilot-2026', preferredPort: 7317 };
  await t('the PortPilot self-entry is not matched to its own MCP server (packaged)', () => {
    const mcp = { port: 8788, pid: 31840, processName: 'PortPilot.exe', address: '127.0.0.1:8788', commandLine: PACKAGED_MCP };
    const { matches, unknownConflicts } = matchPortsToApps([mcp], [self]);
    assert.equal(matches.pp, undefined);
    assert.equal(unknownConflicts.length, 0);
  });
  await t('the PortPilot self-entry is not matched to its own MCP server (dev, cwd is on the command line)', () => {
    const mcp = { port: 8788, pid: 5000, processName: 'electron.exe', address: '127.0.0.1:8788', commandLine: DEV_MCP };
    const { matches } = matchPortsToApps([mcp], [self]);
    assert.equal(matches.pp, undefined);
  });
  await t('a binding held by this very process is reported as a conflict on the preferred port, never a match', () => {
    const mine = { port: 7317, pid: process.pid, processName: 'node.exe', address: '127.0.0.1:7317', commandLine: 'node I:\\Scratch\\PortPilot-2026\\src\\agent\\server.js' };
    const { matches, unknownConflicts } = matchPortsToApps([mine], [self]);
    assert.equal(matches.pp, undefined);
    assert.equal(unknownConflicts.length, 1);
    assert.equal(unknownConflicts[0].occupiedBy.pid, process.pid);
  });
  await t('a parent app does not claim its worktree child\'s server; the child does', () => {
    const parent = { id: 'p', name: 'PortPilot', cwd: 'I:/Scratch/PortPilot-2026', preferredPort: 7317 };
    const child = { id: 'c', name: 'landing', cwd: 'I:/Scratch/PortPilot-2026-landing-redesign-340', preferredPort: 7318 };
    const srv = { port: 7318, pid: 61, processName: 'node.exe', address: '127.0.0.1:7318', commandLine: 'node I:\\Scratch\\PortPilot-2026-landing-redesign-340\\src\\agent\\server.js' };
    const { matches } = matchPortsToApps([srv], [parent, child]);
    assert.equal(matches.p, undefined);
    assert.equal(matches.c && matches.c.port, 7318);
    assert.equal(matches.c.matchType, 'cwd');
  });
  await t('on the preferred port, a worktree server is not the parent\'s either (Phase 2 folder-name test)', () => {
    const parent = { id: 'p', name: 'Parent Shop', cwd: 'I:/Scratch/shop', preferredPort: 7317 };
    const srv = { port: 7317, pid: 63, processName: 'node.exe', address: '127.0.0.1:7317', commandLine: 'node I:\\Scratch\\shop-landing\\server.js' };
    const { matches, unknownConflicts } = matchPortsToApps([srv], [parent]);
    assert.equal(matches.p, undefined);
    assert.equal(unknownConflicts.length, 1);
  });
  await t('an own binding listed second on the preferred port is still seen', () => {
    const pp = { id: 'pp', name: 'PortPilot', cwd: 'I:/Scratch/PortPilot-2026', preferredPort: 7317 };
    // No cwd on either command line, so Phase 1 passes and Phase 2 judges the name evidence.
    const other = { pid: 64, processName: 'node.exe', address: '[::1]:7317', commandLine: 'node portpilot-agent.js' };
    const mine = { pid: process.pid, processName: 'node.exe', address: '127.0.0.1:7317', commandLine: 'node portpilot-agent.js' };
    const { matches, unknownConflicts } = matchPortsToApps([{ port: 7317, ...other, bindings: [other, mine] }], [pp]);
    assert.equal(matches.pp, undefined);
    assert.equal(unknownConflicts.length, 1);
  });
  await t('the parent still matches its own server', () => {
    const parent = { id: 'p', name: 'PortPilot', cwd: 'I:/Scratch/PortPilot-2026', preferredPort: 7317 };
    const srv = { port: 7317, pid: 62, processName: 'node.exe', address: '127.0.0.1:7317', commandLine: 'node I:\\Scratch\\PortPilot-2026\\src\\agent\\server.js' };
    assert.equal(matchPortsToApps([srv], [parent]).matches.p.port, 7317);
  });

  // ---- kill path -----------------------------------------------------------
  await t('killProcess refuses this process and a protected child pid', async () => {
    const r1 = await killProcess(process.pid);
    assert.equal(r1.success, false);
    assert.match(r1.error, /PortPilot itself/);
    guard.protectPid(424243);
    const r2 = await killProcess(424243);
    guard.unprotectPid(424243);
    assert.equal(r2.success, false);
    assert.match(r2.error, /PortPilot itself/);
  });
  await t('killByPort refuses a port this process holds (and the listener survives)', async () => {
    const srv = net.createServer();
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const r = await killByPort(port);
      assert.equal(r.success, false);
      if (/No process found/.test(r.error || '')) {
        if (process.env.CI) throw new Error(`the port scanner did not see this process on ${port}; the pid guard was not exercised`);
        console.log('     SKIP: the port scanner did not see this process on', port, '- the pid guard was not exercised here');
      } else {
        assert.match(r.error, /PortPilot itself/);
      }
      assert.ok(srv.listening, 'listener is still up');
    } finally {
      srv.close();
    }
  });

  // ---- folderToOpen --------------------------------------------------------
  await t('folderToOpen: a directory opens itself, a file opens its parent, a URL or missing path opens nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-folder-'));
    const file = path.join(dir, 'app.exe');
    fs.writeFileSync(file, '');
    assert.equal(folderToOpen(dir), dir);
    assert.equal(folderToOpen(`"${dir}"`), dir);
    assert.equal(folderToOpen(file), dir);
    assert.equal(folderToOpen('file:///' + dir.replace(/\\/g, '/')), null);
    assert.equal(folderToOpen('http://127.0.0.1:3000'), null);
    assert.equal(folderToOpen(path.join(dir, 'nope')), null);
    assert.equal(folderToOpen(''), null);
    assert.equal(folderToOpen('\\\\attacker\\share\\x'), null, 'UNC is never opened');
    assert.equal(folderToOpen('//attacker/share'), null);
    assert.equal(folderToOpen('src'), null, 'relative paths are not resolved against the app cwd');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
