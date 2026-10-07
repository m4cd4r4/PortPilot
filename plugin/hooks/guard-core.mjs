/**
 * PortPilot mod: the pure half of the status line and the dev-server guard.
 *
 * No I/O here. register.tsx gathers the inputs (config, runtime sidecar, the
 * listening-port scan) through `$` and hands them in, so this file runs the
 * same under the hooks engine, `claude plugin test` and plain Node (CI covers
 * it from tests/plugin-mod.test.mjs).
 *
 * Liveness is by port alone: an app is up when the port the sidecar recorded
 * (or its preferredPort) is listening. That needs no desktop app and no
 * command-line lookup, at the cost of trusting that the process on an app's
 * port is that app.
 */
import { describeConflict, provenanceOf, runtimeStateOf } from './lib/core.mjs';

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
export function appStates(config, runtime, listeners, now) {
  const rtApps = (runtime && runtime.apps) || {};
  const rows = [];
  for (const app of (config && config.apps) || []) {
    if (!app || !app.id) continue;
    const rt = rtApps[app.id] || null;
    const port = appPort(app, rt);
    if (!port) continue;
    const claude = !!rt && provenanceOf(rt.startedBy).kind === 'claude';
    if (listeners.has(port)) {
      // Another app holds its port: not up, and not known to have crashed.
      if (!holdersOf(port, listeners.get(port), config, runtime).some((h) => h.id === app.id)) continue;
      rows.push({ id: app.id, name: app.name, port, state: 'running', claude });
      continue;
    }
    const state = runtimeStateOf(rt, { listening: false, now });
    if (state) rows.push({ id: app.id, name: app.name, port, state, claude });
  }
  // Apps that share a port and cannot be told apart are one server: one row.
  const merged = [];
  for (const r of rows) {
    const same = r.state === 'running' && merged.find((m) => m.state === 'running' && m.port === r.port);
    if (same) { same.name = `${same.name}/${r.name}`; same.claude ||= r.claude; } else merged.push(r);
  }
  // Worst state first, then by port.
  const rank = { crashed: 0, starting: 1, running: 2 };
  return merged.sort((a, b) => rank[a.state] - rank[b.state] || a.port - b.port);
}

/**
 * The status line text, e.g. `⚓ 1 crashed · 2 up · ✕ api · :3000 web✦`,
 * or undefined when PortPilot has no apps registered (nothing to say).
 */
export function statusLine(config, runtime, listeners, now) {
  if (!config || !Array.isArray(config.apps) || config.apps.length === 0) return undefined;
  const rows = appStates(config, runtime, listeners, now);
  const crashed = rows.filter((r) => r.state === 'crashed').length;
  const starting = rows.filter((r) => r.state === 'starting').length;
  const up = rows.length - crashed - starting;
  const parts = [];
  if (crashed) parts.push(`${crashed} crashed`);
  if (starting) parts.push(`${starting} starting`);
  parts.push(`${up} up`);
  for (const r of rows.slice(0, MAX_LISTED)) {
    const mark = r.claude ? '✦' : '';
    const name = `${shortName(r.name)}${mark}`;
    parts.push(r.state === 'crashed' ? `✕ ${name}` : r.state === 'starting' ? `◐ ${name}` : `:${r.port} ${name}`);
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

// The same flags with their value, removed to compare two commands' scripts.
const PORT_STRIP = [
  [/(?:^|\s)(?:--port[=\s]+|-p\s+)\d{2,5}\b/g, ''],
  [/^(python3?\s+-m\s+http\.server)\s+\d{2,5}\b/, '$1'],
  [/(runserver)\s+(?:[\d.]+:)?\d{2,5}\b/, '$1'],
];

// A port flag whose value is not a literal number (`--port $P`): unknown port.
const PORT_UNREAD = /(?:^|\s)(?:--port[=\s]+|-p\s+)(?!\d{2,5}\b)\S/;

const OPERATORS = ['&&', '||', ';', '|', '&', '\n'];

function unquote(s) {
  return s.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Split a command into steps at unquoted shell operators.
 * @returns {null | Array<{text:string, op:string|null, redirect:boolean, subst:boolean}>}
 *   op        the operator after the step (null for the last)
 *   redirect  an unquoted `<` or `>` in the step
 *   subst     a subshell, `$(...)` or backtick in the step
 *   null when the quotes do not balance.
 */
function splitSteps(command) {
  const s = String(command || '').replace(/\r/g, '');
  const steps = [];
  let step = { text: '', redirect: false, subst: false };
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const substHere = ch === '`' || (ch === '$' && s[i + 1] === '(');
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && substHere) step.subst = true;
      else if (quote === '"' && ch === '\\') { step.text += ch + (s[i + 1] ?? ''); i++; continue; }
      step.text += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; step.text += ch; continue; }
    if (ch === '\\') { step.text += ch + (s[i + 1] ?? ''); i++; continue; }
    const op = OPERATORS.find((o) => s.startsWith(o, i));
    // `2>&1` and `&>` are redirects, not a background `&`.
    if (op && !(op === '&' && (s[i - 1] === '>' || s[i + 1] === '>'))) {
      steps.push({ ...step, text: step.text.trim(), op });
      step = { text: '', redirect: false, subst: false };
      i += op.length - 1;
      continue;
    }
    if (ch === '<' || ch === '>') step.redirect = true;
    if (substHere || ch === '(' || ch === ')') step.subst = true;
    step.text += ch;
  }
  if (quote) return null;
  steps.push({ ...step, text: step.text.trim(), op: null });
  // A trailing `&` leaves an empty last step.
  while (steps.length && !steps[steps.length - 1].text) steps.pop();
  return steps;
}

/**
 * One step read as a dev-server start, or null.
 * @returns {null | {port:number|null, portKnown:boolean, env:boolean, script:string}}
 *   port       an explicit port (`--port`, `-p`, `PORT=`), or null
 *   portKnown  false when PORT or a port flag is set to something not literal
 *   env        a leading env assignment other than PORT
 *   script     the command with env and port flags removed, `npm run x` as `npm x`
 */
export function devStart(text) {
  let body = String(text || '').trim();
  let port = null;
  let portKnown = true;
  let env = false;
  for (;;) {
    const m = body.match(/^([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s+(.*)$/);
    if (!m) break;
    if (m[1] !== 'PORT') env = true;
    else if (/^\d{2,5}$/.test(m[2])) port = Number(m[2]);
    else portKnown = false;
    body = m[3];
  }
  if (!DEV_START.some((re) => re.test(body))) return null;
  // `npm run dev -- --port 3001` forwards the flag.
  for (const re of PORT_PATTERNS) {
    const m = body.match(re);
    if (m) { port = Number(m[1]); break; }
  }
  if (PORT_UNREAD.test(body)) portKnown = false;
  // Redirects do not change what starts (parseStart marks the step not bare).
  let script = body.replace(/\s*(?:\d*>>?|&>>?|<)\s*(?:&\d+|\S+)/g, '');
  for (const [re, to] of PORT_STRIP) script = script.replace(re, to);
  script = script.replace(/\s+--\s*$/, '').replace(/\s+/g, ' ').trim()
    .replace(/^(npm|pnpm|yarn|bun) run /, '$1 ');
  return { port, portKnown, env, script };
}

/**
 * Parse a Bash command for a dev-server start.
 * @returns {null | {cd: string|null, port: number|null, script: string, raw: string, certain: boolean, bare: boolean}}
 *   cd       the directory a leading `cd X &&` chain moves to (as written), or null
 *   port     an explicit port (`--port`, `-p`, `PORT=`, `export PORT=`), or null
 *   script   the start, normalised for comparing with an app's command
 *   raw      the start step as written (runnable, unlike script)
 *   certain  the directory and the port can be read from the command: no
 *            other step before the start, no subshell, no PORT read from a variable
 *   bare     certain, and nothing but a leading cd chain and a trailing `&`
 *            around the start, so start_app can stand in for the whole command
 */
export function parseStart(command) {
  const steps = splitSteps(command);
  if (!steps) return null;
  let cd = null;
  let port = null;
  let certain = !steps.some((s) => s.subst);
  let bare = true;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const start = devStart(step.text);
    if (start) {
      if (start.port) port = start.port;
      if (!start.portKnown) certain = false;
      const last = i === steps.length - 1;
      if (start.env || step.redirect || !(last && (step.op === null || step.op === '&'))) bare = false;
      return { cd, port, script: start.script, raw: step.text, certain, bare: certain && bare };
    }
    // A step before the start: it must run first and must not move the
    // directory in a way the command does not show.
    if (!['&&', ';', '\n'].includes(step.op) || step.redirect) certain = false;
    const cdm = step.text.match(/^(?:cd|pushd)\s+((['"]).*\2|[^\s'"$*?~`-][^\s'"$*?`]*|~[^\s'"$*?`]*)$/);
    if (cdm) {
      const to = unquote(cdm[1]);
      cd = cd && !isAbsolute(to) ? `${cd}/${to}` : to;
      continue;
    }
    const exp = step.text.match(/^export\s+(.+)$/);
    if (exp && exp[1].split(/\s+/).every((a) => /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(a))) {
      bare = false;
      for (const a of exp[1].split(/\s+/)) {
        const [k, v] = a.split('=');
        if (k === 'PORT') { if (/^\d{2,5}$/.test(v)) port = Number(v); else certain = false; }
      }
      continue;
    }
    // Anything else before the start (`npm install`, `set PORT=` which bash
    // does not export, a source): the start's directory or port is unknown.
    certain = false;
  }
  return null;
}

// ---- Paths ------------------------------------------------------------------

/**
 * Comparable form of a path: forward slashes, no trailing slash, `.`/`..` folded.
 * keepCase skips the windows lower-casing, for a path that is written back.
 */
export function normPath(p, { windows = false, keepCase = false } = {}) {
  let s = String(p || '').replace(/\\/g, '/');
  // Git Bash spells I:\x as /i/x.
  if (windows) s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`);
  const abs = s.startsWith('/') ? '/' : '';
  const out = [];
  for (const part of s.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..' && !/:$/.test(out[out.length - 1])) out.pop(); continue; }
    out.push(part);
  }
  const joined = abs + out.join('/');
  return windows && !keepCase ? joined.toLowerCase() : joined;
}

function isAbsolute(p) {
  return /^([a-zA-Z]:)?[\\/]/.test(p) || p.startsWith('~');
}

/** The directory a start runs in: the session cwd, moved by a leading cd. */
export function startDir(sessionCwd, cd, { windows = false, home = '', keepCase = false } = {}) {
  if (!cd) return normPath(sessionCwd, { windows, keepCase });
  let target = cd;
  if (target.startsWith('~')) target = home + target.slice(1);
  if (!isAbsolute(target)) target = `${sessionCwd}/${target}`;
  return normPath(target, { windows, keepCase });
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

/** The app's registered command read as a start, or null when it is not one. */
function registeredStart(app) {
  return app && app.command ? devStart(app.command) : null;
}

/**
 * The port a start will bind, or null when that is not certain: its explicit
 * port, else the registered app's port when the command is the app's own.
 * `npm run preview` in an app registered as `npm run dev` binds a port the
 * guard cannot know, and neither does `npm run dev` for an app whose
 * registered command carries its own `--port`.
 */
export function targetPort({ start, dir, config, windows = false }) {
  if (!start.certain) return null;
  if (start.port) return start.port;
  const app = appInDir(registeredApps(config), dir, windows);
  const reg = registeredStart(app);
  if (reg && reg.script === start.script && !reg.port) return Number(app.preferredPort) || null;
  return null;
}

/**
 * The registered apps that may be holding a listening port: the one whose
 * sidecar pid is the listener's, else those whose sidecar records a start on
 * that port, else those whose preferredPort it is. More than one means the
 * guard cannot tell which.
 */
export function holdersOf(port, holder, config, runtime) {
  const apps = registeredApps(config);
  const rtApps = (runtime && runtime.apps) || {};
  const pid = holder && holder.pid;
  const byPid = pid ? apps.filter((a) => rtApps[a.id] && rtApps[a.id].pid === pid) : [];
  if (byPid.length) return byPid;
  const bySidecar = apps.filter((a) => rtApps[a.id] && appPort(a, rtApps[a.id]) === port);
  if (bySidecar.length) return bySidecar;
  return apps.filter((a) => !rtApps[a.id] && Number(a.preferredPort) === port);
}

export function decide({ start, dir, config, runtime, listeners, windows = false }) {
  if (!start.certain) return { action: 'pass' };
  const apps = registeredApps(config);
  const rtApps = (runtime && runtime.apps) || {};
  const app = appInDir(apps, dir, windows);
  const port = targetPort({ start, dir, config, windows });
  if (!port) return { action: 'pass' };

  if (listeners.has(port)) {
    const holder = listeners.get(port);
    const holders = holdersOf(port, holder, config, runtime);
    if (holders.length > 1) {
      const names = holders.map((a) => a.name).join(', ');
      return {
        action: 'deny',
        reason: `PortPilot: :${port} is held by ${holder.processName}${holder.pid ? ` (PID ${holder.pid})` : ''}, and ${names} are all registered on :${port}, so it may be any of them. Reuse :${port} if that is the server you want. Otherwise ask the user before stopping it, or start on a free port.`,
      };
    }
    const holderApp = holders[0] || null;
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

  // A free port and a bare start of a registered app's own command on its own
  // port: start it through PortPilot. start_app runs the registered command,
  // so anything else (another script, another port, a pipe or a step around
  // the start) would be silently changed or dropped.
  const reg = registeredStart(app);
  if (start.bare && reg && reg.script === start.script && port === (reg.port || Number(app.preferredPort))) {
    return { action: 'route', app, port, cd: start.cd };
  }
  return { action: 'pass' };
}

// ---- Auto-register ----------------------------------------------------------

// A package script start with nothing after it: `npm run dev` reads scripts.dev.
const SCRIPT_START = /^(?:npm|pnpm|yarn|bun) (dev|start|serve|preview)$/;
const PORT_FLAG_ALL = /(?:^|\s)(?:--port[=\s]+|-p\s+)(\d{2,5})\b/g;
const HTTP_SERVER_DEFAULT = 8000;

/**
 * The port a start in an unregistered directory will certainly bind, or null:
 * its explicit port, else the one literal `--port N` / `-p N` in the
 * package.json script it names, else 8000 for a bare `python -m http.server`.
 * Framework defaults (Vite 5173, Next 3000) are not certain: config files and
 * .env can move them.
 */
export function autoRegisterPort(start, pkg) {
  if (start.port) return start.port;
  const m = start.script.match(SCRIPT_START);
  if (m) {
    const script = pkg && pkg.scripts && typeof pkg.scripts[m[1]] === 'string' ? pkg.scripts[m[1]] : null;
    if (!script || PORT_UNREAD.test(script)) return null;
    // Two different ports (`concurrently` a server and an API): unknown.
    const ports = new Set([...script.matchAll(PORT_FLAG_ALL)].map((x) => Number(x[1])));
    return ports.size === 1 ? [...ports][0] : null;
  }
  if (/^python3? -m http\.server$/.test(start.script)) return HTTP_SERVER_DEFAULT;
  return null;
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
 * Whether a start the guard passed should register its directory as a new
 * app, then be routed through start_app. Called only after decide() passed,
 * so every deny and pass path there is untouched. Every rule must hold, else
 * null and the command runs as written.
 *
 * @param {object} c
 * @param {object} c.start      from parseStart
 * @param {string} c.dir        normalised directory (comparison form)
 * @param {string} c.cwd        the same directory in the platform's own case
 * @param {object} c.config     PortPilot config ({ apps, settings })
 * @param {Map}    c.listeners  from parseListeners
 * @param {object|null} c.pkg   the directory's package.json, parsed
 * @param {string} c.home       the user's home directory
 * @param {{add:boolean, start:boolean}} c.tools  add_app and start_app connected
 * @returns {null | {name:string, command:string, cwd:string, port:number}}
 */
export function planAutoRegister({ start, dir, cwd, config, listeners, pkg, home = '', tools, windows = false }) {
  const settings = (config && config.settings) || {};
  if (settings.autoRegister === false) return null;
  if (!start || !start.certain || !start.bare) return null;
  const apps = registeredApps(config);
  if (appInDir(apps, dir, windows)) return null;
  if (dir === '/' || /^[a-z]:$/i.test(dir) || (home && dir === normPath(home, { windows }))) return null;
  const port = autoRegisterPort(start, pkg);
  if (!port || listeners.has(port)) return null;
  if (!tools || !tools.add || !tools.start) return null;

  // start_app sets PORT from preferredPort; a --port flag stays so the next
  // bare start still matches the registered command.
  const command = String(start.raw || '').replace(/^(?:PORT=\d{2,5}\s+)+/, '').trim();
  if (!command) return null;
  const pkgName = pkg && typeof pkg.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '').trim() : '';
  const name = uniqueAppName(pkgName || baseName(cwd) || 'app', cwd, apps);
  return { name, command, cwd, port };
}

/**
 * The registered app whose repo a linked worktree belongs to, or null.
 * gitDir and commonDir are `git rev-parse --git-dir --git-common-dir` run in
 * the start's directory; they differ only in a linked worktree, and the main
 * checkout is the common dir's parent.
 */
export function worktreeParent({ dir, gitDir, commonDir, config, windows = false }) {
  if (!gitDir || !commonDir) return null;
  const abs = (p) => normPath(isAbsolute(p) ? p : `${dir}/${p}`, { windows });
  const common = abs(commonDir);
  if (abs(gitDir) === common || !/\/\.git$/.test(common)) return null;
  const main = common.replace(/\/\.git$/, '');
  if (main === dir) return null;
  return appInDir(registeredApps(config), main, windows);
}

/**
 * What the routed Bash call reports, from start_app's tool-call result.
 * A refused call (`deny`) or a failed start (`isError`) is a deny, never
 * "started". On success the stdout notes that a leading cd never ran, since
 * start_app replaced the whole command.
 * @param {{app:object, port:number|null, cd?:string|null}} route  decide's route
 * @param {{deny?:string, isError?:boolean, text?:string}} ran
 */
export function routeResult(route, ran) {
  const name = route.app.name;
  if (ran && ran.deny !== undefined) {
    return { deny: `PortPilot: ${name} is registered in PortPilot, and starting it through start_app was refused (${ran.deny}). Ask the user how they want it started.` };
  }
  const text = (ran && ran.text) || '';
  if (ran && ran.isError) {
    return { deny: `PortPilot: ${name} is registered in PortPilot, and starting it through start_app failed: ${text || 'no detail'}. Ask the user how they want it started.` };
  }
  const onPort = route.port ? ` on :${route.port}` : '';
  const cdNote = route.cd ? ` start_app ran it in the app's own directory, so the shell's working directory was not changed.` : '';
  const regNote = route.registered ? ` This directory was not registered, so PortPilot registered it as "${name}" first (turn this off with the "Register new projects when Claude starts them" setting).` : '';
  return {
    result: {
      stdout: `PortPilot started ${name}${onPort} through its start_app tool instead of a bare shell start, so the server is tracked and the port is checked.${regNote}${cdNote}\n${text}`,
      stderr: '',
      interrupted: false,
    },
  };
}
