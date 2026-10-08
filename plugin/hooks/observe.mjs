/**
 * PortPilot mod: record an unregistered project once Claude's own start of it
 * is listening. Observe, never take over: the start runs exactly as typed.
 *
 * 1. noteStart (the Bash hook, before the call runs): a certain dev-server
 *    start in a directory no app owns writes a pending observation to
 *    <configDir>/observing/<key>.json: cwd, the command as typed, the session,
 *    the time and the ports already listening.
 * 2. completeObservations (after the Bash call returns, and on the 15 s
 *    status tick, which covers run_in_background starts): only this
 *    session's pendings. A port that was not listening before, no registered
 *    app's, held by a process whose chain reaches this session's Claude
 *    process through a shell Claude spawned, every link born after the note,
 *    and whose shell or descendants' command lines carry the noted command
 *    (where the platform reports them, and the cwd too), is recorded through
 *    add_app with registeredBy 'observed'. One port, one pending: anything
 *    else is uncertain and nothing is recorded. A pending with no match after
 *    OBSERVE_MS expires. A finished pending's file is deleted; any older than
 *    PRUNE_MS is pruned.
 *
 * No I/O here: register.tsx hands in the callers, tests/plugin-mod.test.mjs
 * hands in fakes, so CI runs the same wiring the hook runs.
 */
import { holdersOf, normPath, startDir } from './guard-core.mjs';

export const OBSERVE_MS = 60_000;
export const PRUNE_MS = 60 * 60_000;
export const READ_LIMIT = 50;
// Process creation times and the note's clock can disagree by this much.
const CLOCK_SKEW_MS = 2_000;
// The shells Claude's Bash tool runs a command in (zsh: macOS's login shell).
const SHELLS = /^(bash|sh|dash|zsh|cmd|powershell|pwsh)(\.exe)?$/;
const PENDING_FILE = /^dir-[0-9a-f]+\.json$/;
const HOME_CHILDREN = ['desktop', 'documents', 'downloads'];
// Subcommands of a dev tool that finish without serving (`npx next build`).
const ONE_SHOT = new Set(['build', 'lint', 'check', 'generate', 'export', 'test', 'typecheck', 'sync', 'info', 'prepare', 'analyze', 'add', 'telemetry', 'optimize']);

/** A UNC path (`//wsl.localhost/x`, `\\server\share`): normPath would fold it into a local one. */
export function isUncPath(p) {
  return /^[\\/]{2}[^\\/]/.test(String(p || ''));
}

/** A file-name-safe key for a directory (comparison form). */
export function observeKey(dir) {
  let h = 5381;
  for (const ch of String(dir)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return `dir-${h.toString(16)}`;
}

/** `npx next build`, `vite build`, `astro check`: a dev tool run that never serves. */
export function isOneShot(raw) {
  let s = String(raw || '').trim();
  for (let m; (m = s.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*|npx|bunx|pnpm\s+exec)\s+(.*)$/)); ) s = m[1];
  const sub = s.split(/\s+/)[1] || '';
  return ONE_SHOT.has(sub.toLowerCase());
}

function ownerOf(config, dir, windows) {
  return ((config && config.apps) || []).find((a) => a && a.id && a.cwd && normPath(a.cwd, { windows }) === dir) || null;
}

/**
 * Where a start should be observed, or null when it should not.
 * @returns {null | {dir:string, cwd:string}}  dir in comparison form, cwd as saved
 */
export function observable({ start, sessionCwd, config, home = '', windows = false }) {
  if (!config || ((config.settings || {}).autoRegister === false)) return null;
  if (!start || !start.certain || isOneShot(start.raw)) return null;
  if (isUncPath(sessionCwd) || isUncPath(start.cd)) return null;
  let cwd = startDir(sessionCwd, start.cd, { windows, home, keepCase: true });
  if (windows) cwd = cwd.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
  const dir = normPath(cwd, { windows });
  if (dir === '/' || /^[a-z]:$/i.test(dir)) return null;
  if (home) {
    const h = normPath(home, { windows });
    if (dir === h || HOME_CHILDREN.some((c) => dir.toLowerCase() === `${h}/${c}`.toLowerCase())) return null;
  }
  if (ownerOf(config, dir, windows)) return null;
  return { dir, cwd };
}

/**
 * The process table, after `SELF <pid>`: Windows (PowerShell) prints
 * `pid<TAB>ppid<TAB>createdMs<TAB>name<TAB>commandLine` per process; POSIX
 * prints `ps -axo pid=,ppid=,comm=`, then `ARGS`, then `ps -axo pid=,args=`.
 * A plain `pid ppid name` line (no time, no command line) is read too.
 */
export function parseProcTable(stdout) {
  const procs = new Map();
  let self = null;
  let args = false;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const s = line.trim();
    if (s === 'ARGS') { args = true; continue; }
    const me = s.match(/^SELF\s+(\d+)$/);
    if (me) { self = Number(me[1]); continue; }
    if (line.includes('\t')) {
      const [pid, ppid, created, name = '', ...cmd] = line.split('\t');
      if (/^\s*\d+$/.test(pid) && /^\d+$/.test(ppid)) {
        procs.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), name: name.trim(), created: Number(created) || 0, cmd: cmd.join(' ').trim() });
      }
      continue;
    }
    if (args) {
      const a = s.match(/^(\d+)\s+(.+)$/);
      if (a && procs.has(Number(a[1]))) procs.get(Number(a[1])).cmd = a[2].trim();
      continue;
    }
    const m = s.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m) procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name: m[3].trim(), created: 0, cmd: '' });
  }
  return { self, procs };
}

const baseOf = (procs, p) => String(procs.get(p).name).split(/[\\/]/).pop().toLowerCase();

function ancestors(pid, procs) {
  const out = [];
  for (let p = pid, i = 0; p && procs.has(p) && i < 64; i++) {
    out.push(p);
    const next = procs.get(p).ppid;
    if (next === p) break;
    p = next;
  }
  return out;
}

/** This Claude session's process: the nearest `claude` above the probe, else the nearest `node`. */
export function sessionPid({ self, procs }) {
  if (!self) return null;
  const up = ancestors(self, procs).slice(1);
  return up.find((p) => /^claude(\.exe)?$/.test(baseOf(procs, p))) || up.find((p) => /^node(\.exe)?$/.test(baseOf(procs, p))) || null;
}

/**
 * The listener's chain up to (not including) the session process, when it
 * reaches it through a shell the session spawned directly; else null. An MCP
 * server's child, or anything Claude's own process holds, has no such shell.
 */
export function shellChain(pid, owner, procs) {
  const up = ancestors(pid, procs);
  const at = up.indexOf(owner);
  if (at < 1) return null;
  const chain = up.slice(0, at);
  return SHELLS.test(baseOf(procs, chain[at - 1])) ? chain : null;
}

/**
 * Pid reuse: every link was born at or after the note, each after its parent.
 * Where the platform reports no creation times, there is nothing to check.
 */
export function bornAfter(chain, owner, procs, at) {
  const links = [...chain, owner].map((p) => procs.get(p).created || 0);
  if (links.every((t) => !t)) return true;
  if (links.some((t) => !t)) return false;
  if (links.slice(0, -1).some((t) => t < at - CLOCK_SKEW_MS)) return false;
  // Parent and child times come from one OS clock: no skew between them.
  return links.every((t, i) => i === links.length - 1 || t >= links[i + 1]);
}

const squash = (s) => String(s || '').replace(/["'`\\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const LAUNCHER = /^(?:\S+=\S*\s+)*(?:npx|bunx|pnpm exec|npm|pnpm|yarn|bun)\s+/;

/**
 * How well the chain's command lines carry the noted start: 3 the whole Bash
 * command, 2 the start step, 1 the step past its launcher in a descendant of
 * the shell (`run dev` in npm's node), 0 none. Where the platform reports no
 * command line for any link, the tree alone decides (1).
 */
export function commandScore(p, chain, procs) {
  const cmds = chain.map((pid) => squash(procs.get(pid).cmd));
  if (!cmds.some(Boolean)) return 1;
  const has = (list, s) => !!s && list.some((c) => c && c.includes(s));
  const full = squash(p.command);
  const raw = squash(p.raw);
  if (full && full !== raw && has(cmds, full)) return 3;
  if (has(cmds, raw)) return 2;
  const tail = raw.replace(LAUNCHER, '');
  return tail.includes(' ') && has(cmds.slice(0, -1), tail) ? 1 : 0;
}

/**
 * The ports each open pending can claim: new since its baseline, no
 * registered app's, held under a shell of this session (not by the session
 * process itself), born after the note, in its cwd where the cwd is known,
 * and carrying its command where command lines are known. Only the best
 * command match per pending counts.
 * @returns {Map<string, number[]>}  pending key -> candidate ports
 */
export function candidates({ pendings, listeners, table, cwds = new Map(), windows = false, config = null, runtime = null }) {
  const owner = sessionPid(table);
  const out = new Map();
  for (const p of pendings) {
    let ports = [];
    let best = 0;
    if (owner) {
      for (const l of listeners.values()) {
        if (p.before.includes(l.port) || !l.pid || l.pid === owner) continue;
        if (config && holdersOf(l.port, l, config, runtime).length) continue;
        const chain = shellChain(l.pid, owner, table.procs);
        if (!chain || !bornAfter(chain, owner, table.procs, p.at)) continue;
        const cwd = cwds.get(l.pid);
        if (cwd && normPath(cwd, { windows }) !== p.dir) continue;
        const score = commandScore(p, chain, table.procs);
        if (!score || score < best) continue;
        if (score > best) { best = score; ports = []; }
        ports.push(l.port);
      }
    }
    out.set(p.key, ports);
  }
  return out;
}

/**
 * Which files in observing/ to read this tick (newest first, at most
 * READ_LIMIT) and which to delete (older than PRUNE_MS, at most READ_LIMIT).
 * @param {Array<{name:string, mtimeMs?:number}>} entries
 */
export function pickPendingFiles(entries, now) {
  const files = (entries || []).filter((e) => e && PENDING_FILE.test(e.name))
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  const stale = (e) => now - (e.mtimeMs || 0) > PRUNE_MS;
  return {
    read: files.filter((e) => !stale(e)).slice(0, READ_LIMIT).map((e) => e.name),
    prune: files.filter(stale).slice(0, READ_LIMIT).map((e) => e.name),
  };
}

/** argv that deletes one pending file, no shell parsing of the path; null when it is not one. */
export function removeArgv(file, windows) {
  const f = String(file || '');
  if (!/[\\/]observing[\\/]dir-[0-9a-f]+\.json$/.test(f)) return null;
  if (!windows) return ['rm', '-f', '--', f];
  // cmd still parses the line: only a plain drive path goes through it.
  if (!/^[A-Za-z]:[\\/][^"&|<>^%!()\r\n]*$/.test(f)) return null;
  return ['cmd', '/d', '/c', 'del', '/f', '/q', f.replace(/\//g, '\\')];
}

function baseName(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

/** A display name no registered app has (case-insensitive, as add_app checks). */
export function uniqueAppName(wanted, cwd, apps) {
  const taken = new Set(apps.map((a) => String(a.name || '').toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  const parent = baseName(cwd.split('/').slice(0, -1).join('/'));
  const withParent = parent ? `${wanted} (${parent})` : wanted;
  if (!taken.has(withParent.toLowerCase())) return withParent;
  for (let n = 2; ; n++) if (!taken.has(`${withParent}-${n}`.toLowerCase())) return `${withParent}-${n}`;
}

/**
 * Note a start to observe. Never throws, never changes the command.
 * @param {object} io  { readPending(key), writePending(key, rec) }
 * @param {object} c   { start, sessionCwd, config, listeners, home, windows, session, now }
 * @returns {Promise<object|null>} the pending written, or null
 */
export async function noteStart(io, c) {
  try {
    const where = observable(c);
    if (!where) return null;
    const key = observeKey(where.dir);
    const prior = await io.readPending(key).catch(() => null);
    // A second start in the same cwd while the first is still pending keeps
    // the first's baseline, so the first's new port still reads as new.
    if (prior && !prior.done && c.now - prior.at < OBSERVE_MS) return prior;
    const rec = { v: 1, key, dir: where.dir, cwd: where.cwd, raw: c.start.raw, command: c.command || c.start.raw, session: c.session, at: c.now, before: [...c.listeners.keys()] };
    await io.writePending(key, rec);
    return rec;
  } catch {
    return null;
  }
}

const settling = new Set();

/**
 * Finish what can be finished: record matched observations, expire old ones.
 * @param {object} io  { listPending(), readPending(key), writePending(key, rec), removePending(key),
 *                       snapshot(), procTable(), cwdOf(pid), readJson(path), tool(name), call(args) }
 * @param {object} c   { now, windows, session }  only this session's pendings are completed
 * @returns {Promise<Array<{key:string, done:string, port?:number}>>}
 */
export async function completeObservations(io, { now, windows = false, session }) {
  const results = [];
  const finish = async (p, done, extra = {}) => {
    await io.removePending(p.key).catch(() => {});
    results.push({ key: p.key, done, ...extra });
  };
  try {
    const listed = ((await io.listPending()) || []).filter(Boolean);
    // Any session's file past PRUNE_MS (its session is gone), and this session's leftovers.
    for (const p of listed) {
      if (now - p.at > PRUNE_MS || (p.done && p.done !== 'recording' && p.session === session)) await io.removePending(p.key).catch(() => {});
    }
    const all = listed.filter((p) => session && p.session === session && !p.done && now - p.at <= PRUNE_MS && !settling.has(p.key));
    if (!all.length) return results;
    const open = [];
    for (const p of all) {
      if (now - p.at > OBSERVE_MS) await finish(p, 'expired');
      else open.push(p);
    }
    if (!open.length) return results;
    const { config, runtime = null, listeners } = await io.snapshot();
    if (!config || !listeners) return results;
    const live = [];
    for (const p of open) {
      if ((config.settings || {}).autoRegister === false) await finish(p, 'off');
      else if (ownerOf(config, p.dir, windows)) await finish(p, 'registered');
      else live.push(p);
    }
    // Nothing new is listening: skip the process table.
    if (!live.some((p) => [...listeners.keys()].some((port) => !p.before.includes(port)))) return results;

    const table = await io.procTable();
    const cwds = new Map();
    for (const l of listeners.values()) {
      if (l.pid && live.some((p) => !p.before.includes(l.port))) {
        const cwd = await io.cwdOf(l.pid).catch(() => null);
        if (cwd) cwds.set(l.pid, cwd);
      }
    }
    const byKey = candidates({ pendings: live, listeners, table, cwds, windows, config, runtime });
    const claims = new Map();
    for (const ports of byKey.values()) for (const port of ports) claims.set(port, (claims.get(port) || 0) + 1);
    const addApp = await io.tool('add_app');
    for (const p of live) {
      const ports = byKey.get(p.key) || [];
      if (!ports.length) continue; // not up yet: wait until it expires
      // Two new ports, or a port two pendings could own: uncertain, record nothing.
      if (ports.length > 1 || claims.get(ports[0]) > 1) { await finish(p, 'ambiguous'); continue; }
      if (!addApp) { await finish(p, 'no-tool'); continue; }
      // Another completion in this process got here first (no await between the check and the add).
      if (settling.has(p.key)) continue;
      settling.add(p.key);
      try {
        // Another completion may have finished it (and deleted the file) since the list.
        const cur = await io.readPending(p.key).catch(() => null);
        if (!cur || cur.done || cur.at !== p.at) continue;
        await io.writePending(p.key, { ...p, done: 'recording', port: ports[0] }).catch(() => {});
        const pkg = await io.readJson(`${p.cwd}/package.json`).catch(() => null);
        const pkgName = pkg && typeof pkg.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '').trim() : '';
        const apps = ((config.apps) || []).filter((a) => a && a.id);
        const name = uniqueAppName(pkgName || baseName(p.cwd) || 'app', p.cwd, apps);
        const added = await io.call({
          tool: addApp, name, command: p.raw, cwd: p.cwd, preferredPort: ports[0],
          description: 'Recorded from Claude Code', registeredBy: 'observed', observedSession: p.session,
        }).catch((err) => ({ isError: true, text: String((err && err.message) || err) }));
        await finish(p, added && !added.isError && added.deny === undefined ? 'recorded' : 'failed', { port: ports[0] });
      } finally {
        settling.delete(p.key);
      }
    }
  } catch { /* nothing recorded; a later tick or the expiry clears it */ }
  return results;
}
