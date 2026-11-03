/**
 * PortPilot must never mistake itself for one of the apps it manages, and must never kill itself.
 *
 * Incident (code review, 2026-11-02): the "PortPilot" app entry (cwd I:/Scratch/PortPilot-2026,
 * preferred port 7317) was matched to PortPilot's own shared MCP server, because that child's
 * command line ("PortPilot.exe ...\resources\mcp-server\index.js --port 8788") contains
 * "portpilot". The row showed :8788, Open opened the MCP endpoint (HTTP 400) and Stop
 * taskkilled the MCP server, dropping the PortPilot tools from every Claude session until the
 * desktop app was restarted. A second bug in the same matcher let an app's cwd match any
 * command line carrying a LONGER path with that prefix (I:/x/app matched I:/x/app-worktree).
 *
 * Three guards, shared by the port matcher and the kill path:
 *   - a command line or process name belonging to PortPilot's own servers is never an app's server
 *   - a cwd matches a command line only at a path boundary
 *   - pids PortPilot runs in (Electron main, the MCP child, the web agent) are never killed
 */

// The shared MCP server: forked from the Electron app (packaged: PortPilot.exe
// ...\PortPilot\resources\mcp-server\index.js; dev: electron.exe I:\...\PortPilot-2026\mcp-server\index.js).
// The folder right above mcp-server (or above resources) is a PortPilot checkout or install, so
// a user project that merely has "portpilot" somewhere else on its command line is not caught.
const OWN_SERVER_CMD = /[\\/]portpilot[^\\/"'\s]*[\\/](?:resources[\\/])?mcp-server[\\/]index\.js(?=["'\s]|$)/i;
const OWN_PROCESS_NAME = /^portpilot(\.exe)?$/i;

/** Is this listener's command line one of PortPilot's own servers? */
function isOwnServerCommand(commandLine) {
  return OWN_SERVER_CMD.test(String(commandLine || ''));
}

/** "PortPilot.exe" (the packaged app and its forked MCP child). */
function isOwnProcessName(processName) {
  return OWN_PROCESS_NAME.test(String(processName || '').trim());
}

// Pids this PortPilot process must never kill: itself, plus children it registers (the MCP child).
const ownPids = new Set([process.pid]);
function protectPid(pid) { const n = Number(pid); if (Number.isInteger(n) && n > 0) ownPids.add(n); }
function unprotectPid(pid) { if (Number(pid) !== process.pid) ownPids.delete(Number(pid)); }
function isOwnPid(pid) { return ownPids.has(Number(pid)); }

/** A port binding is PortPilot's own by pid, process name or command line. */
function isOwnBinding(binding) {
  if (!binding) return false;
  return isOwnPid(binding.pid) || isOwnProcessName(binding.processName) || isOwnServerCommand(binding.commandLine);
}

// What may sit around a path on a command line: quotes, blanks, `=` and `(`, `,` before it; a path
// separator or the shell punctuation that can follow one (`cd /x/app;`, `(cd /x/app)`, `PATH=/x/app:/y`) after.
const BEFORE = new Set(['"', "'", ' ', '\t', '=', '(', ',']);
const AFTER = new Set(['"', "'", ' ', '\t', '\\', '/', ';', ',', ')', '&', ':', '`']);
const SEP = new Set(['\\', '/']);

function findBounded(cmd, needle, beforeSet) {
  let at = cmd.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? undefined : cmd[at - 1];
    const after = cmd[at + needle.length];
    if ((before === undefined || beforeSet.has(before)) && (after === undefined || AFTER.has(after))) return true;
    at = cmd.indexOf(needle, at + 1);
  }
  return false;
}

/**
 * Does the command line name this directory, as a whole path component?
 * "I:/x/app" is found in `node I:\x\app\server.js` and `--cwd="I:/x/app"`, and not in
 * `node I:\x\app-worktree\server.js`. Case-insensitive; either slash style on either side.
 */
function cmdNamesPath(commandLine, dir) {
  const cmd = String(commandLine || '').toLowerCase();
  const base = String(dir || '').toLowerCase().replace(/[\\/]+$/, '');
  if (!cmd || !base) return false;
  for (const needle of new Set([base.replace(/\//g, '\\'), base.replace(/\\/g, '/')])) {
    if (findBounded(cmd, needle, BEFORE)) return true;
  }
  return false;
}

/**
 * Does the command line name this folder as one whole path segment? "app" is found in
 * `I:\x\app\server.js` and not in `I:\x\app-worktree\server.js` or `I:\x\myapp\s.js`.
 */
function cmdNamesFolder(commandLine, name) {
  const cmd = String(commandLine || '').toLowerCase();
  const seg = String(name || '').toLowerCase().trim();
  if (!cmd || !seg) return false;
  return findBounded(cmd, seg, new Set([...BEFORE, ...SEP]));
}

module.exports = { isOwnServerCommand, isOwnProcessName, isOwnBinding, protectPid, unprotectPid, isOwnPid, cmdNamesPath, cmdNamesFolder };
