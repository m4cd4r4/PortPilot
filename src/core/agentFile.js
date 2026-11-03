/**
 * agent.json: the standalone web agent (src/agent/server.js) records {port, token, pid} here so
 * tooling can find it. A Windows force-terminate skips process.on('exit'), so the file can
 * outlive its process; every reader therefore checks the pid is alive and deletes a stale file
 * (seen: a dead pid 24492 surviving for days, 2026-11-02 review).
 */
const fs = require('fs');
const path = require('path');

const FILE = 'agent.json';

function agentFilePath(dir) { return path.join(dir, FILE); }

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // alive but not ours
}

/**
 * The live agent recorded in `dir`, or null. A file whose pid is dead, missing or unreadable
 * is removed on the way out so the next reader never sees it.
 */
function readLiveAgent(dir) {
  const file = agentFilePath(dir);
  let info;
  try { info = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } }
    return null;
  }
  if (info && Number.isInteger(info.port) && pidAlive(info.pid)) return info;
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
  return null;
}

/** Write {port, token, pid, ...} to `dir`, readable only by the user. Returns the file path. */
function writeAgent(dir, info) {
  fs.mkdirSync(dir, { recursive: true });
  const file = agentFilePath(dir);
  fs.writeFileSync(file, JSON.stringify({ ...info, pid: info.pid || process.pid }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* non-POSIX */ }
  return file;
}

/** Remove the file only if it is this process's own record (another live agent keeps its own). */
function removeAgent(dir, pid = process.pid) {
  const file = agentFilePath(dir);
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (info && info.pid && info.pid !== pid) return false;
  } catch { /* unreadable or missing: remove anyway */ }
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
  return true;
}

module.exports = { readLiveAgent, writeAgent, removeAgent, agentFilePath, pidAlive };
