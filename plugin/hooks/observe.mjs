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
 *    covers run_in_background starts): while a note is under NOTICE_MS old, a
 *    port not listening at the last check, and no registered app's, gets one
 *    notice per session naming the port, the noted command and its directory.
 *    The notice is handed to Claude with the next tool result.
 *
 * Pure: register.tsx keeps the state in $.state and hands in the snapshot;
 * tests/plugin-mod.test.mjs drives the same functions with fakes.
 */
import { holdersOf, normPath, startDir } from './guard-core.mjs';

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

/** The text Claude reads for one new port. */
export function noticeText(port, notes) {
  const after = notes.map((n) => `\`${n.command}\` in ${baseName(n.cwd) || n.cwd}`).join(', or ');
  const how = notes.map((n) => `cwd "${n.cwd}", command as you ran it (\`${n.command}\`), name "${n.name}"`).join('; or ');
  return `PortPilot: :${port} started listening after ${after}. If you started it, register it with PortPilot's add_app tool (${how}, preferredPort ${port}, registeredBy "observed"). If you did not start it, ignore this.`;
}

/**
 * One check: which new ports to tell Claude about.
 * @param {object} snap  { config, runtime, listeners }  listeners null when the scan failed
 * @returns {{ state: object, notices: string[] }}
 */
export function checkNotices(state, { config, runtime = null, listeners }, now) {
  if (off(config)) return { state: { ...state, notes: [] }, notices: [] };
  const notes = state.notes.filter((n) => now - n.at <= NOTICE_MS);
  if (!listeners) return { state: { ...state, notes }, notices: [] };
  const ports = [...listeners.keys()];
  const before = new Set(state.lastPorts || ports);
  const noticed = new Set(state.noticed);
  const notices = [];
  if (notes.length) {
    for (const port of ports) {
      if (before.has(port) || noticed.has(port)) continue;
      if (holdersOf(port, listeners.get(port), config, runtime).length) continue;
      noticed.add(port);
      notices.push(noticeText(port, notes));
    }
  }
  return { state: { ...state, notes, lastPorts: ports, noticed: [...noticed].slice(-MAX_NOTICED) }, notices };
}
