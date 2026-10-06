/**
 * PortPilot mod: the pure half of the status line and the dev-server guard.
 *
 * No I/O here. register.ts gathers the inputs (config, runtime sidecar, the
 * listening-port scan) through `$` and hands them in, so this file runs the
 * same under the hooks engine, `claude plugin test` and plain Node (CI covers
 * it from tests/plugin-mod.test.mjs).
 *
 * Liveness is by port alone: an app is up when the port the sidecar recorded
 * (or its preferredPort) is listening. That needs no desktop app and no
 * command-line lookup, at the cost of trusting that the process on an app's
 * port is that app.
 */
import { describeConflict, provenanceOf } from './lib/core.mjs';

const MAX_LISTED = 3;
const MAX_NAME = 16;

// ---- Port scan parsing ------------------------------------------------------

/**
 * Listening TCP ports from the platform's scan output.
 * @param {'win32'|'darwin'|'linux'} platform
 * @param {string} stdout  `netstat -ano` | `lsof -iTCP -sTCP:LISTEN -n -P` | `ss -tlnp`
 * @returns {Map<number, {port:number, pid:number|null, processName:string}>}
 */
export function parseListeners(platform, stdout) {
  const out = new Map();
  const add = (port, pid, processName) => {
    if (port >= 1 && port <= 65535 && !out.has(port)) out.set(port, { port, pid: pid || null, processName: processName || 'Unknown' });
  };
  for (const raw of String(stdout || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (platform === 'win32') {
      // Locale-independent: a listener is a TCP row whose foreign address ends :0.
      if (!/^TCP\b/i.test(line)) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 5 || !/:0$/.test(parts[2])) continue;
      const m = parts[1].match(/:(\d+)$/);
      if (m) add(Number(m[1]), Number(parts[4]));
    } else if (platform === 'darwin') {
      const parts = line.split(/\s+/);
      const m = parts.length >= 9 && parts[8].match(/:(\d+)$/);
      if (m) add(Number(m[1]), Number(parts[1]), parts[0]);
    } else {
      if (!/^LISTEN\b/.test(line) && !/^tcp/i.test(line)) continue;
      const m = line.match(/:(\d+)\s/);
      if (!m) continue;
      const pid = line.match(/pid=(\d+)/);
      const name = line.match(/users:\(\("([^"]+)"/);
      add(Number(m[1]), pid ? Number(pid[1]) : null, name ? name[1] : null);
    }
  }
  return out;
}

/** Image name from `tasklist /FI "PID eq N" /FO CSV /NH`, or null. */
export function parseTasklistName(stdout) {
  const m = String(stdout || '').match(/^"([^"]+)","\d+"/m);
  return m ? m[1] : null;
}

// ---- Status line ------------------------------------------------------------

function appPort(app, rt) {
  return Number((rt && rt.port) || app.preferredPort) || null;
}

function shortName(name) {
  const n = String(name || '?');
  return n.length > MAX_NAME ? `${n.slice(0, MAX_NAME - 1)}…` : n;
}

/**
 * Per-app state from the config, the runtime sidecar and the scan.
 * running: its port is listening. crashed: PortPilot recorded a start (the
 * sidecar keeps the entry until a PortPilot stop) and the port is gone.
 * Apps that are neither are left out.
 */
export function appStates(config, runtime, listeners) {
  const rtApps = (runtime && runtime.apps) || {};
  const rows = [];
  for (const app of (config && config.apps) || []) {
    if (!app || !app.id) continue;
    const rt = rtApps[app.id] || null;
    const port = appPort(app, rt);
    const claude = !!rt && provenanceOf(rt.startedBy).kind === 'claude';
    if (port && listeners.has(port)) rows.push({ id: app.id, name: app.name, port, state: 'running', claude });
    else if (rt && port) rows.push({ id: app.id, name: app.name, port, state: 'crashed', claude });
  }
  // Worst state first, then by port.
  const rank = { crashed: 0, running: 1 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || a.port - b.port);
}

/**
 * The status line text, e.g. `⚓ 1 crashed · 2 up · ✕ api · :3000 web✦`,
 * or undefined when PortPilot has no apps registered (nothing to say).
 */
export function statusLine(config, runtime, listeners) {
  if (!config || !Array.isArray(config.apps) || config.apps.length === 0) return undefined;
  const rows = appStates(config, runtime, listeners);
  const crashed = rows.filter((r) => r.state === 'crashed').length;
  const up = rows.length - crashed;
  const parts = [];
  if (crashed) parts.push(`${crashed} crashed`);
  parts.push(`${up} up`);
  for (const r of rows.slice(0, MAX_LISTED)) {
    const mark = r.claude ? '✦' : '';
    parts.push(r.state === 'crashed' ? `✕ ${shortName(r.name)}${mark}` : `:${r.port} ${shortName(r.name)}${mark}`);
  }
  if (rows.length > MAX_LISTED) parts.push(`+${rows.length - MAX_LISTED}`);
  return `⚓ ${parts.join(' · ')}`;
}

// ---- Dev-server start detection ---------------------------------------------

// A command that starts a long-running dev server. Deliberately narrow: a
// false match on `npm run build` would deny or reroute a call that never
// binds a port.
const DEV_START = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)(?:\s|$)/,
  /^(?:npx|pnpm\s+exec|bunx)\s+(?:next|vite|astro|nuxt|nuxi|serve|http-server|live-server)(?:\s|$)/,
  /^(?:next|vite|astro|nuxt)\s+(?:dev|start|preview)(?:\s|$)/,
  /^python3?\s+-m\s+http\.server(?:\s|$)/,
  /^python3?\s+manage\.py\s+runserver(?:\s|$)/,
  /^(?:uvicorn|flask\s+run)(?:\s|$)/,
];

const PORT_PATTERNS = [
  /(?:^|\s)--port[=\s]+(\d{2,5})\b/,
  /(?:^|\s)-p\s+(\d{2,5})\b/,
  /^python3?\s+-m\s+http\.server\s+(\d{2,5})\b/,
  /runserver\s+(?:[\d.]+:)?(\d{2,5})\b/,
];

function unquote(s) {
  return s.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Parse a Bash command for a dev-server start.
 * @returns {null | {cd: string|null, port: number|null}}
 *   cd    the directory a leading `cd X &&` moves to (as written), or null
 *   port  an explicit port (`--port`, `-p`, `PORT=`), or null
 */
export function parseStart(command) {
  const segments = String(command || '').split(/\s*(?:&&|;)\s*/).map((s) => s.trim()).filter(Boolean);
  let cd = null;
  for (const seg of segments) {
    const cdm = seg.match(/^(?:cd|pushd)\s+(.+)$/);
    if (cdm) { cd = unquote(cdm[1].trim()); continue; }
    let body = seg;
    let port = null;
    // Leading env assignments: `PORT=3001 npm run dev`, `export PORT=...` is not a start.
    for (;;) {
      const env = body.match(/^([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s+(.*)$/);
      if (!env) break;
      if (env[1] === 'PORT' && /^\d{2,5}$/.test(env[2])) port = Number(env[2]);
      body = env[3];
    }
    // `npm run dev -- --port 3001` forwards the flag; strip a trailing `&` too.
    body = body.replace(/\s*&\s*$/, '');
    if (!DEV_START.some((re) => re.test(body))) {
      // Only a leading cd chain counts; anything else before the start ends it.
      if (!/^(?:export|set)\s/.test(seg)) cd = null;
      continue;
    }
    for (const re of PORT_PATTERNS) {
      const m = body.match(re);
      if (m) { port = Number(m[1]); break; }
    }
    return { cd, port };
  }
  return null;
}

// ---- Paths ------------------------------------------------------------------

/** Comparable form of a path: forward slashes, no trailing slash, `.`/`..` folded. */
export function normPath(p, { windows = false } = {}) {
  let s = String(p || '').replace(/\\/g, '/');
  // Git Bash spells I:\x as /i/x.
  if (windows) s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:');
  const abs = s.startsWith('/') ? '/' : '';
  const out = [];
  for (const part of s.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..' && !/:$/.test(out[out.length - 1])) out.pop(); continue; }
    out.push(part);
  }
  const joined = abs + out.join('/');
  return windows ? joined.toLowerCase() : joined;
}

function isAbsolute(p) {
  return /^([a-zA-Z]:)?[\\/]/.test(p) || p.startsWith('~');
}

/** The directory a start runs in: the session cwd, moved by a leading cd. */
export function startDir(sessionCwd, cd, { windows = false, home = '' } = {}) {
  if (!cd) return normPath(sessionCwd, { windows });
  let target = cd;
  if (target.startsWith('~')) target = home + target.slice(1);
  if (!isAbsolute(target)) target = `${sessionCwd}/${target}`;
  return normPath(target, { windows });
}

// ---- Guard decision ---------------------------------------------------------

/**
 * Decide what to do with a dev-server start.
 *
 * @param {object} c
 * @param {{cd:string|null, port:number|null}} c.start   from parseStart
 * @param {string} c.dir         normalised directory the start runs in
 * @param {object} c.config      PortPilot config ({ apps })
 * @param {object} c.runtime     runtime sidecar ({ apps: { id: { startedBy, port } } })
 * @param {Map}    c.listeners   from parseListeners
 * @param {boolean} [c.windows]  compare paths case-insensitively
 * @returns {{action:'pass'} | {action:'deny', reason:string} | {action:'route', app:object, port:number|null}}
 */
function registeredApps(config) {
  return ((config && config.apps) || []).filter((a) => a && a.id);
}

function appInDir(apps, dir, windows) {
  return apps.find((a) => a.cwd && normPath(a.cwd, { windows }) === dir) || null;
}

/** The port a start will bind: its explicit port, else the app registered for its directory. */
export function targetPort({ start, dir, config, windows = false }) {
  const app = appInDir(registeredApps(config), dir, windows);
  return start.port || (app && Number(app.preferredPort)) || null;
}

export function decide({ start, dir, config, runtime, listeners, windows = false }) {
  const apps = registeredApps(config);
  const rtApps = (runtime && runtime.apps) || {};
  const app = appInDir(apps, dir, windows);
  const port = targetPort({ start, dir, config, windows });

  if (port && listeners.has(port)) {
    const holder = listeners.get(port);
    const holderApp = (app && appPort(app, rtApps[app.id]) === port ? app : null)
      || apps.find((a) => appPort(a, rtApps[a.id]) === port) || null;
    const holderStartedBy = holderApp && rtApps[holderApp.id] ? rtApps[holderApp.id].startedBy : null;
    const conflict = describeConflict({ port, holder, holderApp, holderStartedBy, app });
    if (app && holderApp && holderApp.id === app.id) {
      return {
        action: 'deny',
        reason: `PortPilot: ${app.name} is already running on :${port} - reuse http://localhost:${port} instead of starting a second copy. (${conflict.sentence})`,
      };
    }
    return {
      action: 'deny',
      reason: `PortPilot: ${conflict.sentence}. Reuse :${port} if that is the server you want. Otherwise ask the user before stopping it, or start on a free port.`,
    };
  }

  // A free port and a registered app: start it through PortPilot, unless the
  // command asks for a port other than the one PortPilot would use.
  if (app && (!start.port || start.port === Number(app.preferredPort))) {
    return { action: 'route', app, port };
  }
  return { action: 'pass' };
}
