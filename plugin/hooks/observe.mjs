/**
 * PortPilot mod: record an unregistered project once Claude's own start of it
 * is listening. Observe, never take over: the start runs exactly as typed.
 *
 * 1. noteStart (the Bash hook, before the call runs): a certain dev-server
 *    start in a directory no app owns writes a pending observation to
 *    <configDir>/observing/<key>.json: cwd, the command as typed, the session,
 *    the time and the ports already listening.
 * 2. completeObservations (after the Bash call returns, and on the 15 s
 *    status tick, which covers run_in_background and `&` starts): a port that
 *    was not listening before, held by a process in this Claude session's own
 *    process tree (and, where the platform reports it, running in that cwd),
 *    is recorded through add_app with registeredBy 'observed'. One port, one
 *    pending: anything else is uncertain and nothing is recorded. A pending
 *    with no match after OBSERVE_MS expires.
 *
 * No I/O here: register.tsx hands in the callers, tests/plugin-mod.test.mjs
 * hands in fakes, so CI runs the same wiring the hook runs.
 */
import { normPath, startDir } from './guard-core.mjs';

export const OBSERVE_MS = 60_000;
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
 * The process table: `SELF <pid>` then `pid ppid name` per line (Windows,
 * from PowerShell), or `ps -axo pid=,ppid=,comm=` after `SELF <pid>`.
 */
export function parseProcTable(stdout) {
  const procs = new Map();
  let self = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const s = line.trim();
    const me = s.match(/^SELF\s+(\d+)$/);
    if (me) { self = Number(me[1]); continue; }
    const m = s.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m) procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name: m[3].trim() });
  }
  return { self, procs };
}

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
  const base = (p) => String(procs.get(p).name).split(/[\\/]/).pop().toLowerCase();
  return up.find((p) => /^claude(\.exe)?$/.test(base(p))) || up.find((p) => /^node(\.exe)?$/.test(base(p))) || null;
}

/**
 * The ports each open pending can claim: new since its baseline, held by a
 * process under this session, and in its cwd where the cwd is known.
 * @returns {Map<string, number[]>}  pending key -> candidate ports
 */
export function candidates({ pendings, listeners, table, cwds = new Map(), windows = false }) {
  const owner = sessionPid(table);
  const out = new Map();
  for (const p of pendings) {
    const ports = [];
    if (owner) {
      for (const l of listeners.values()) {
        if (p.before.includes(l.port) || !l.pid) continue;
        if (!ancestors(l.pid, table.procs).includes(owner)) continue;
        const cwd = cwds.get(l.pid);
        if (cwd && normPath(cwd, { windows }) !== p.dir) continue;
        ports.push(l.port);
      }
    }
    out.set(p.key, ports);
  }
  return out;
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
    const rec = { v: 1, key, dir: where.dir, cwd: where.cwd, raw: c.start.raw, session: c.session, at: c.now, before: [...c.listeners.keys()] };
    await io.writePending(key, rec);
    return rec;
  } catch {
    return null;
  }
}

const settling = new Set();

/**
 * Finish what can be finished: record matched observations, expire old ones.
 * @param {object} io  { listPending(), writePending(key, rec), snapshot(), procTable(), cwdOf(pid),
 *                       readJson(path), tool(name), call(args) }
 * @param {object} c   { now, windows }
 * @returns {Promise<Array<{key:string, done:string, port?:number}>>}
 */
export async function completeObservations(io, { now, windows = false }) {
  const results = [];
  const finish = async (p, done, extra = {}) => {
    await io.writePending(p.key, { ...p, done, ...extra }).catch(() => {});
    results.push({ key: p.key, done, ...extra });
  };
  try {
    const all = ((await io.listPending()) || []).filter((p) => p && !p.done && !settling.has(p.key));
    if (!all.length) return results;
    const open = [];
    for (const p of all) {
      if (now - p.at > OBSERVE_MS) await finish(p, 'expired');
      else open.push(p);
    }
    if (!open.length) return results;
    const { config, listeners } = await io.snapshot();
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
    const byKey = candidates({ pendings: live, listeners, table, cwds, windows });
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
        await finish(p, 'recording', { port: ports[0] });
        results.pop();
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
