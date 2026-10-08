/**
 * PortPilot mod: tell Claude when a port appears after its own start of an
 * unregistered project, so Claude (who knows what it ran) can register it.
 * PortPilot never guesses who started a server and never registers on its
 * own: process-tree attribution is not reliable (on Windows a background
 * Bash shell's parent exits, so the server's chain never reaches Claude).
 *
 * 1. noteStart (the Bash hook, before the call runs): a certain dev-server
 *    start in a directory no app owns adds a note {dir, cwd, command, name, at}
 *    to this session's state, and takes the ports listening now as the baseline.
 * 2. checkNotices (after every tool call, and on the 15 s status tick, which
 *    covers run_in_background starts): while a note is under NOTICE_MS old,
 *    the ports not listening at the last check, and not held by a running
 *    registered app, go into one notice naming each port's PID, process and
 *    bind address, the noted command (cmd-safe) and its directory. Claude
 *    decides which, if any, its start opened. Each port is told once a session.
 * 3. takeQueued (with the next tool result): hands Claude the queued notices,
 *    dropping any older than NOTICE_MS, and all of them when opted out.
 *
 * Pure: register.tsx keeps the state in $.state and hands in the snapshot;
 * tests/plugin-mod.test.mjs drives the same functions with fakes.
 */
import { normPath, startDir } from './guard-core.mjs';

export const NOTICE_MS = 2 * 60_000;
const MAX_NOTES = 5;
const MAX_NOTICED = 200;
const HOME_CHILDREN = ['desktop', 'documents', 'downloads'];
// Subcommands of a dev tool that finish without serving (`npx next build`).
const ONE_SHOT = new Set(['build', 'lint', 'check', 'generate', 'export', 'test', 'typecheck', 'sync', 'info', 'prepare', 'analyze', 'add', 'telemetry', 'optimize']);

/** This session's observe state before anything is noted. */
export const EMPTY = Object.freeze({ notes: [], lastPorts: null, noticed: [], queue: [] });

/** A UNC path (`//wsl.localhost/x`, `\\server\share`): normPath would fold it into a local one. */
export function isUncPath(p) {
  return /^[\\/]{2}[^\\/]/.test(String(p || ''));
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

const off = (config) => !config || ((config.settings || {}).autoRegister === false);

/**
 * Where a start should be noted, or null when it should not.
 * @returns {null | {dir:string, cwd:string}}  dir in comparison form, cwd as saved
 */
export function observable({ start, sessionCwd, config, home = '', windows = false }) {
  if (off(config)) return null;
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

/** The name to suggest: package.json's (scope dropped), else the folder's, made unique. */
export function suggestName(pkg, cwd, config) {
  const pkgName = pkg && typeof pkg.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '').trim() : '';
  const apps = ((config && config.apps) || []).filter((a) => a && a.id);
  return uniqueAppName(pkgName || baseName(cwd) || 'app', cwd, apps);
}

/**
 * Note a start. Never changes the command; returns the state unchanged when
 * the start is not one to note.
 * @param {object} c  { start, sessionCwd, config, listeners, home, windows, now, pkg }
 */
export function noteStart(state, c) {
  const where = observable(c);
  if (!where) return state;
  const note = { dir: where.dir, cwd: where.cwd, command: c.start.raw, name: suggestName(c.pkg, where.cwd, c.config), at: c.now };
  const notes = [...state.notes.filter((n) => n.dir !== where.dir), note].slice(-MAX_NOTES);
  return { ...state, notes, lastPorts: [...c.listeners.keys()] };
}

/**
 * A bash start step as a command start_app can run under cmd.exe: leading
 * `VAR=value` assignments move to env, trailing redirections and `&` go
 * (they would write `/tmp/x` as `<drive>:\tmp\x`; PortPilot logs the app itself).
 * Kept in step with cmdSafe in mcp-server/index.js.
 * @returns {{command:string, env:Record<string,string>}}
 */
export function cmdSafe(raw) {
  let s = String(raw || '').trim().replace(/(^|[^&])&$/, '$1').trim();
  const env = {};
  for (let w = shellWords(s); w.length > 1 && w[0].bare && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0].raw); w = shellWords(s)) {
    const name = w[0].raw.slice(0, w[0].raw.indexOf('='));
    env[name] = w[0].text.slice(name.length + 1);
    s = s.slice(w[1].start);
  }
  const cut = trailingShellOnly(shellWords(s));
  if (cut > 0) s = s.slice(0, cut);
  return { command: s.trim().replace(/\s+/g, ' '), env };
}

/** Bash words with their source span; `bare` when the word does not start quoted or escaped. */
function shellWords(s) {
  const out = [];
  let cur = null, q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!q && /\s/.test(ch)) { if (cur) { cur.end = i; out.push(cur); cur = null; } continue; }
    if (!cur) cur = { start: i, end: s.length, text: '', bare: !(ch === '"' || ch === "'" || ch === '\\'), redirAt: -1 };
    if (!q && (ch === '>' || ch === '<') && cur.redirAt < 0) cur.redirAt = i - cur.start;
    if (q) {
      if (ch === q) q = null;
      else if (q === '"' && ch === '\\' && i + 1 < s.length) cur.text += s[++i];
      else cur.text += ch;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '\\' && i + 1 < s.length) cur.text += s[++i];
    else cur.text += ch;
  }
  if (cur) out.push(cur);
  return out.map((w) => ({ ...w, raw: s.slice(w.start, w.end) }));
}

const REDIRECT = /^\d?(?:&>>?|>>?&?|<)/;

/**
 * Where a trailing run of redirections, `| tee ...` and `&` starts in s, or -1.
 * A `>` inside quotes is an argument; one glued to a word (`3000>x.log`) is a
 * redirection, as bash reads it.
 */
function trailingShellOnly(words) {
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const whole = w.bare && REDIRECT.test(w.raw);
    if (!whole && !(w.redirAt > 0)) continue;
    const head = whole ? w.raw : w.raw.slice(w.redirAt);
    const op0 = head.match(REDIRECT);
    if (!op0) continue;
    let k = i + (head.length > op0[0].length ? 1 : 2);
    while (k < words.length) {
      const x = words[k];
      const op = x.bare && x.raw.match(REDIRECT);
      if (op) k += x.raw.length > op[0].length ? 1 : 2;
      else if (x.bare && x.raw === '|' && words[k + 1] && words[k + 1].text === 'tee') k = words.length;
      else if (x.bare && x.raw === '&' && k === words.length - 1) k += 1;
      else break;
    }
    if (k >= words.length) return whole ? w.start : w.start + w.redirAt;
  }
  return -1;
}

/** A registered app is running on the port: its sidecar pid holds it, or its sidecar records a start there. preferredPort alone is not. */
function heldByRunningApp(port, holder, config, runtime) {
  const rt = (runtime && runtime.apps) || {};
  return ((config && config.apps) || []).some((a) => {
    const r = a && a.id && rt[a.id];
    return !!r && ((holder && holder.pid && r.pid === holder.pid) || Number(r.port || a.preferredPort) === port);
  });
}

/** The ports a check would tell Claude about, so their holders can be named first. */
export function freshPorts(state, { config, runtime = null, listeners }) {
  if (!listeners || !state.notes.length) return [];
  const before = new Set(state.lastPorts || listeners.keys());
  const noticed = new Set(state.noticed);
  return [...listeners.keys()].filter((p) => !before.has(p) && !noticed.has(p) && !heldByRunningApp(p, listeners.get(p), config, runtime)).sort((a, b) => a - b);
}

const EPHEMERAL = 49152;

/** The port to suggest from one process's ports: the lowest below the ephemeral range, else the lowest. */
function mainPort(list) {
  return list.find((p) => p < EPHEMERAL) ?? list[0];
}

/**
 * The text Claude reads for the new ports of one check, one line per process.
 * @param {number[]} newPorts  sorted
 * @param {Map} listeners      holders, names already resolved where possible
 */
export function noticeText(newPorts, notes, listeners = new Map()) {
  const after = notes.map((n) => `\`${n.command}\` in ${baseName(n.cwd) || n.cwd}`).join(', or ');
  const groups = new Map();
  for (const p of newPorts) {
    const h = listeners.get(p) || {};
    const key = h.pid ? `pid:${h.pid}` : `port:${p}`;
    if (!groups.has(key)) groups.set(key, { holder: h, ports: [] });
    groups.get(key).ports.push(p);
  }
  const lines = [...groups.values()].map(({ holder, ports }) => {
    const main = mainPort(ports);
    const extra = ports.filter((p) => p !== main);
    const proc = holder.processName && holder.processName !== 'Unknown' ? holder.processName : 'unknown process';
    const who = `${proc}${holder.pid ? `, PID ${holder.pid}` : ''}${holder.address ? `, bound to ${holder.address}` : ''}`;
    const also = extra.length ? ` (also ${extra.map((p) => `:${p}`).join(', ')}: extra listeners of the same process, not servers to register)` : '';
    return { main, text: `- :${main}: ${who}${also}` };
  });
  const listed = newPorts.map((p) => `:${p}`).join(', ');
  const how = notes.map((n) => {
    const { command, env } = cmdSafe(n.command);
    const envPart = Object.keys(env).length ? `, env ${JSON.stringify(env)}` : '';
    return `cwd "${n.cwd}", command "${command}"${envPart}, name "${n.name}"`;
  }).join('; or ');
  const port = lines.length === 1 ? `preferredPort ${lines[0].main}` : `preferredPort set to the one port your start opened (${lines.map((l) => `:${l.main}`).join(' or ')})`;
  return [
    `PortPilot: ${listed} started listening after ${after}.`,
    ...lines.map((l) => l.text),
    'Register only a port you are confident your own start opened. A port held by a process you did not start is not yours: ignore it.',
    `To register it, call PortPilot's add_app tool with ${how}, ${port}, registeredBy "observed".`,
  ].join('\n');
}

/**
 * One check: which new ports to tell Claude about, as at most one notice.
 * @param {object} snap  { config, runtime, listeners }  listeners null when the scan failed
 * @returns {{ state: object, notices: string[] }}
 */
export function checkNotices(state, { config, runtime = null, listeners }, now) {
  if (off(config)) return { state: { ...state, notes: [], queue: [] }, notices: [] };
  const notes = state.notes.filter((n) => now - n.at <= NOTICE_MS);
  if (!listeners) return { state: { ...state, notes }, notices: [] };
  const fresh = freshPorts({ ...state, notes }, { config, runtime, listeners });
  const notices = fresh.length ? [noticeText(fresh, notes, listeners)] : [];
  const noticed = [...state.noticed, ...fresh].slice(-MAX_NOTICED);
  return { state: { ...state, notes, lastPorts: [...listeners.keys()], noticed }, notices };
}

/**
 * The queued notices to hand Claude now: none when opted out (the queue is
 * cleared), and none older than NOTICE_MS (dropped).
 * @returns {{ state: object, notices: string[] }}
 */
export function takeQueued(state, config, now) {
  const notices = off(config) ? [] : state.queue.filter((q) => now - q.at <= NOTICE_MS).map((q) => q.text);
  return { state: { ...state, queue: [] }, notices };
}
