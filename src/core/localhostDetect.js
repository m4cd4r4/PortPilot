/**
 * Which listening ports are a developer's own localhost server, and which
 * project each one belongs to. Pure decisions for the desktop's localhost
 * watcher (src/main/localhostWatcher.js): no scanning, no probing, no Electron.
 *
 *   classify(portInfo, opts)  -> { dev, reason }
 *   deriveProject(commandLine, opts?) -> { name, cwd, startCommand, relative? }
 *   candidateFolders(sources, opts?) -> string[][]  (ordered groups for deriveProject's opts.candidates)
 *   resolveRelative(commandLine, groups, opts?) -> { cwd, file } | null
 *   detectedAppId(cwd, name, port) -> 'det_<10 hex>'
 *
 * portInfo is one portScanner.scanPorts() item:
 * { port, pid, address, processName, commandLine, bindings }.
 *
 * Conservative on purpose: a false positive adds noise to the History tab, a
 * false negative loses a page. When in doubt a port is NOT a dev server.
 *
 * Zero dependencies beyond Node's fs/path/crypto - the VS Code extension loads a copy.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- What counts as a dev server ------------------------------------------

const MIN_PORT = 1024;
const MAX_PORT = 65535;

// Process names (lower case, no .exe) that run a developer's own server.
const DEV_RUNTIMES = new Set([
  'node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node', 'nodemon',
  'python', 'python3', 'pythonw', 'py', 'pypy', 'pypy3',
  'ruby', 'php', 'dotnet', 'java',
  'uvicorn', 'gunicorn', 'hypercorn', 'daphne', 'flask', 'django-admin', 'rails', 'puma',
  'npm', 'pnpm', 'yarn', 'npx', 'vite', 'next', 'nuxt', 'astro', 'webpack',
]);

// Never a user's server, whatever is on the command line: browsers, editors,
// agents and chat/desktop apps (the idea of NOT_A_SERVER in the MCP server and
// the VS Code extension, widened), PortPilot itself, and OS or infrastructure
// services (databases, Docker, web servers, model servers).
const NOT_A_SERVER_NAME = new RegExp('^(' + [
  'brave', 'chrome', 'chromium', 'msedge', 'msedgewebview2', 'firefox', 'opera', 'vivaldi', 'safari',
  'code', 'code-insiders', 'cursor', 'windsurf', 'idea', 'idea64', 'webstorm', 'webstorm64', 'pycharm', 'pycharm64', 'devenv',
  'claude', 'codex', 'electron', 'slack', 'discord', 'teams', 'spotify', 'obsidian', 'notion', 'figma',
  'portpilot.*',
  'system', 'svchost', 'lsass', 'services', 'wininit', 'spoolsv', 'wslrelay', 'wslhost', 'vmmem', 'rapportd', 'sshd', 'syslogd',
  'docker.*', 'com\\.docker.*', 'dockerd', 'containerd', 'vpnkit.*',
  'nginx', 'httpd', 'apache2?', 'caddy', 'traefik', 'haproxy',
  'redis-server', 'redis', 'qdrant', 'postgres', 'postmaster', 'mysqld', 'mariadbd', 'mongod', 'mongos', 'sqlservr', 'memcached',
  'ollama.*', 'whisper.*', 'llama.*', 'lm-studio.*',
].join('|') + ')$', 'i');

// Words on the command line that mark a tool, not a project: MCP servers,
// agents, editor helpers and language servers.
const NOT_A_SERVER_CMD = [
  /\bmcp\b|mcp-server|modelcontextprotocol/i,
  /@anthropic-ai|claude-code|[\\/]\.claude[\\/]|@openai[\\/]codex|gemini-cli|\baider\b/i,
  /programs[\\/](cursor|microsoft vs code|windsurf)|[\\/]\.vscode(-server|-insiders)?[\\/]extensions|vscode-server|--type=(extensionhost|utility|renderer|gpu-process)|bootstrap-fork|extensionhost/i,
  /tsserver|typingsinstaller|typescript[\\/]lib|language-?server|languageserver|\blsp\b|jdtls|jdt\.ls|eslint_d|prettierd|github[.-]copilot|copilot-(language-server|agent)/i,
  /gradledaemon|kotlin-daemon|jetbrains|elasticsearch|kibana|logstash/i,
];
// A service run through a generic runtime (a python redis proxy, a Jupyter kernel).
// Judged on the first words of the command line only, so a project folder that
// happens to be named like one is not hit.
const SERVICE_WORDS = /^(redis|qdrant|postgres|mysql|mongo|memcached|whisper|ollama|jupyter|grafana|prometheus)/i;

// The ports PortPilot itself serves (the shared MCP server and the web agent).
const OWN_PORTS = [8788, 7317];
// The default Node inspector port. `--inspect=PORT` and friends are read from the command line.
const INSPECTOR_PORT = 9229;

/** "C:\Program Files\nodejs\node.exe" -> "node" */
function procName(name) {
  return String(name || '').trim().replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
}

/** The host part of a scanner address: "127.0.0.1:3000", "[::1]:3000", "*:3000". */
function hostOf(address) {
  const a = String(address || '');
  const m = /^\[(.+)\]:\d+$/.exec(a) || /^(.*):\d+$/.exec(a);
  return (m ? m[1] : a).toLowerCase().replace(/^::ffff:/, '');
}

const isLoopbackHost = (h) => /^127\./.test(h) || h === '::1' || h === 'localhost';
const isAllHost = (h) => h === '0.0.0.0' || h === '::' || h === '*' || h === '';

/** Reachable from this machine's own loopback: bound to loopback or to every interface. */
function isLocalBinding(address) {
  const h = hostOf(address);
  return isLoopbackHost(h) || isAllHost(h);
}

/** Ports a command line asks the Node inspector to use. */
function inspectorPorts(commandLine) {
  const out = new Set();
  const re = /--(?:inspect|inspect-brk|inspect-wait|inspect-port|debug|debug-port)(?:=|\s+)(?:[\w.\[\]:-]*:)?(\d{2,5})\b/gi;
  for (let m = re.exec(commandLine); m; m = re.exec(commandLine)) out.add(Number(m[1]));
  return out;
}

/**
 * Is this listening port a developer's localhost server?
 * opts.ownPorts: extra ports PortPilot serves on (default OWN_PORTS are always skipped).
 */
function classify(portInfo, opts = {}) {
  const p = portInfo || {};
  const port = Number(p.port);
  const no = (reason) => ({ dev: false, reason });
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return no('port outside 1024-65535');
  if (OWN_PORTS.includes(port) || (opts.ownPorts || []).map(Number).includes(port)) return no('PortPilot port');

  // A shared port can carry several bindings (one per pid); any one that
  // qualifies makes the port a candidate, judged on that binding alone.
  const bindings = Array.isArray(p.bindings) && p.bindings.length ? p.bindings : [p];
  let why = 'no process name';
  for (const b of bindings) {
    const same = b === p || b.pid === p.pid;
    const verdict = classifyBinding(port, {
      address: b.address || p.address,
      processName: b.processName || (same ? p.processName : ''),
      commandLine: b.commandLine || (same ? p.commandLine : ''),
    });
    if (verdict.dev) return verdict;
    why = verdict.reason;
  }
  return no(why);
}

function classifyBinding(port, b) {
  const no = (reason) => ({ dev: false, reason });
  const name = procName(b.processName);
  const cmd = String(b.commandLine || '');
  if (!name || name === 'unknown') return no('process name unknown');
  if (NOT_A_SERVER_NAME.test(name)) return no(`not a dev server: ${name}`);
  if (!DEV_RUNTIMES.has(name)) return no(`not a dev runtime: ${name}`);
  if (!isLocalBinding(b.address)) return no('bound to a non-local address');
  if (port === INSPECTOR_PORT || inspectorPorts(cmd).has(port)) return no('inspector/debug port');
  for (const re of NOT_A_SERVER_CMD) if (re.test(cmd)) return no(`tool or service (${re.source.slice(0, 28)})`);
  const lead = tokenize(cmd).slice(0, 3).map((t) => t.replace(/^.*[\\/]/, ''));
  if (lead.some((w) => SERVICE_WORDS.test(w))) return no('service, not a project');
  return { dev: true, reason: `dev runtime ${name} on :${port}` };
}

// ---- Which project a server belongs to ------------------------------------

const MARKERS = ['package.json', '.git', 'pyproject.toml'];
// A folder holding a globally installed tool is not the user's project.
const GLOBAL_FOLDER = /[\\/]appdata[\\/]roaming[\\/](npm|nvm|pnpm|yarn)([\\/]|$)|[\\/]appdata[\\/]local[\\/](pnpm|yarn|nvm|fnm|volta|programs)([\\/]|$)|[\\/]program files( \(x86\))?([\\/]|$)|[\\/]nodejs([\\/]|$)|[\\/]\.(nvm|volta|fnm|deno)([\\/]|$)|[\\/]\.bun[\\/]install|^[\\/]usr[\\/](local[\\/])?lib|[\\/]opt[\\/]homebrew|[\\/]homebrew[\\/]/i;

/** Split a command line into words, honouring double and single quotes. */
function tokenize(commandLine) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(String(commandLine || '')); m; m = re.exec(String(commandLine || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const isAbsolute = (t) => /^[A-Za-z]:[\\/]/.test(t) || /^\/(?!\/)/.test(t) || /^\\\\/.test(t);
const SCRIPT_EXT = /\.(c|m)?[jt]s$|\.py$|\.rb$|\.php$|\.dll$|\.jar$/i;

function exists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

/** The nearest folder at or above `dir` that looks like a project root, else `dir`. */
function projectRootAbove(dir) {
  let cur = dir;
  for (let i = 0; i < 8; i++) {
    if (MARKERS.some((m) => fs.existsSync(path.join(cur, m)))) return cur;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return dir;
}

function folderFromToken(token) {
  const nm = /^(.*?)[\\/]node_modules(?:[\\/]|$)/i.exec(token);
  if (nm && nm[1]) return nm[1];
  const pn = /^(.*?)[\\/]\.pnpm(?:[\\/]|$)/i.exec(token);
  if (pn && pn[1]) return pn[1].replace(/[\\/]node_modules$/i, '');
  if (SCRIPT_EXT.test(token)) return projectRootAbove(path.dirname(token));
  return null;
}

/** "python -m http.server 3117" -> "python http.server"; "node server.js" -> "node server.js". */
function fallbackName(tokens) {
  const runtime = procName(tokens[0]) || 'server';
  const dash = tokens.indexOf('-m');
  if (dash > -1 && tokens[dash + 1]) return `${runtime} ${tokens[dash + 1]}`;
  const nm = tokens.map((t) => /[\\/]node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/i.exec(t)).find(Boolean);
  if (nm) return `${runtime} ${nm[1].replace(/\\/g, '/')}`;
  const script = tokens.slice(1).find((t) => SCRIPT_EXT.test(t));
  if (script) return `${runtime} ${script.replace(/^.*[\\/]/, '')}`;
  return runtime;
}

// ---- A relative script: "node server.js", "python app.py", "php -S localhost:8000" ----
//
// A scanner sees the command line but not the working directory, so a relative script says
// nothing about where it lives. The folder is found by asking where that file exists among
// folders this machine's work is known to happen in. Never a guess: a file that exists in no
// candidate, or in two candidates that cannot be told apart, leaves the folder unknown.

const AMBIGUOUS_MS = 60 * 1000; // two candidates whose file differs by less than this are a tie

const isFileDefault = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const mtimeDefault = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const keyOf = (p) => {
  const k = path.resolve(String(p)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin' ? k.toLowerCase() : k;
};

/**
 * The relative file(s) a command line asks its runtime to run, as alternatives (any one
 * existing in a folder counts), or null when it names none we can look for.
 *   node server.js / python app.py / ruby app.rb   -> ['server.js']
 *   python -m pkg.mod                              -> ['pkg/mod.py', 'pkg/mod/__main__.py']
 *   php -S host:port [-t docroot] [router.php]     -> ['router.php'] or the docroot's index files
 */
function relativeTargets(commandLine) {
  const tokens = tokenize(commandLine);
  const runtime = procName(tokens[0]);
  const rest = tokens.slice(1);
  const relative = (t) => t && !isAbsolute(t) && !t.startsWith('-') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t);
  if (runtime === 'php') {
    const s = rest.indexOf('-S');
    if (s < 0) { const script = rest.find((t) => relative(t) && SCRIPT_EXT.test(t)); return script ? [script] : null; }
    const router = rest.slice(s + 2).find((t) => relative(t) && /\.php$/i.test(t));
    if (router) return [router];
    const t = rest.indexOf('-t');
    const root = t > -1 && relative(rest[t + 1]) ? rest[t + 1].replace(/[\\/]+$/, '') : '';
    return ['index.php', 'index.html', 'index.htm'].map((f) => (root ? `${root}/${f}` : f));
  }
  const dash = rest.indexOf('-m');
  if (/^(python|py|pypy)/.test(runtime) && dash > -1 && /^[A-Za-z_][\w.]*$/.test(rest[dash + 1] || '')) {
    const base = rest[dash + 1].replace(/\./g, '/');
    return [`${base}.py`, `${base}/__main__.py`];
  }
  const script = rest.find((t) => relative(t) && SCRIPT_EXT.test(t));
  return script ? [script] : null;
}

/**
 * Which candidate folder a command line's relative script lives in.
 * `groups` is an ordered list of folder lists (most trustworthy first). The first group
 * with a folder holding the file decides; inside a group, two different folders holding it
 * are told apart by the file's mtime only when it differs by over a minute, else the answer
 * is null (and later groups are not consulted: a tie is not a miss).
 * opts.isFile / opts.mtimeMs are test seams.
 * @returns {{ cwd: string, file: string } | null}
 */
function resolveRelative(commandLine, groups, opts = {}) {
  const targets = relativeTargets(commandLine);
  if (!targets || !Array.isArray(groups)) return null;
  const isFile = opts.isFile || isFileDefault;
  const mtimeMs = opts.mtimeMs || mtimeDefault;
  const done = new Set();
  for (const group of groups) {
    const hits = [];
    for (const folder of Array.isArray(group) ? group : []) {
      if (!folder || typeof folder !== 'string') continue;
      const k = keyOf(folder);
      if (done.has(k)) continue;
      done.add(k);
      const found = targets.map((t) => path.join(folder, t)).filter((p) => isFile(p));
      if (found.length) hits.push({ cwd: folder.replace(/[\\/]+$/, ''), file: found[0], at: Math.max(...found.map(mtimeMs)) });
    }
    if (!hits.length) continue;
    if (hits.length === 1) return { cwd: hits[0].cwd, file: hits[0].file };
    hits.sort((a, b) => b.at - a.at);
    return hits[0].at - hits[1].at > AMBIGUOUS_MS ? { cwd: hits[0].cwd, file: hits[0].file } : null;
  }
  return null;
}

/**
 * Where a relative script could have been started from, as ordered groups for resolveRelative:
 *  1. live Claude sessions' folders (newest first), each with its git root and parents up to 2 levels
 *  2. registered apps' folders
 *  3. the folders of the most recent runs
 * sources: { sessionCwds: string[], appCwds: string[], runCwds: string[] }; a missing folder is dropped.
 * opts.isDir / opts.hasGit are test seams.
 */
function candidateFolders(sources = {}, opts = {}) {
  const isDir = opts.isDir || exists;
  const hasGit = opts.hasGit || ((d) => fs.existsSync(path.join(d, '.git')));
  const clean = (list) => (Array.isArray(list) ? list : []).filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim());
  const around = (cwd) => {
    const out = [cwd];
    let cur = cwd;
    for (let i = 0; i < 8 && !hasGit(cur); i++) { // the git root, if there is one near
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
      if (hasGit(cur)) out.push(cur);
    }
    cur = cwd;
    for (let i = 0; i < 2; i++) {
      const up = path.dirname(cur);
      if (up === cur) break;
      out.push(up);
      cur = up;
    }
    return out;
  };
  const groups = [clean(sources.sessionCwds).flatMap(around), clean(sources.appCwds), clean(sources.runCwds)];
  return groups.map((g) => g.filter((d) => isDir(d)));
}

/**
 * The project a server was started from, read off its command line.
 * startCommand is always null here: it comes from the folder's own scripts, which the
 * watcher reads through projectScanner (the one place that knows package managers).
 *
 * A command line with only a RELATIVE script has no folder in it. opts.candidates (the
 * groups from candidateFolders) lets it be found by where that file exists; `relative: true`
 * on the result says the folder came from there, so the caller knows the original command
 * line, which names the script relatively, is runnable from it.
 */
function deriveProject(commandLine, opts = {}) {
  const tokens = tokenize(commandLine);
  for (const t of tokens.slice(1)) {
    if (!isAbsolute(t)) continue;
    const folder = folderFromToken(t);
    if (!folder || GLOBAL_FOLDER.test(folder + path.sep) || !exists(folder)) continue;
    const cwd = folder.replace(/[\\/]+$/, '');
    return { name: path.basename(cwd) || cwd, cwd, startCommand: null };
  }
  if (opts.candidates) {
    const hit = resolveRelative(commandLine, opts.candidates, opts);
    if (hit) return { name: path.basename(hit.cwd) || hit.cwd, cwd: hit.cwd, startCommand: null, relative: true };
  }
  return { name: fallbackName(tokens), cwd: null, startCommand: null };
}

/** Stable id for a detected server: the same folder (or name) on the same port is the same app. */
function detectedAppId(cwd, name, port, platform = process.platform) {
  let base = cwd ? String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') : `name:${name}`;
  if (cwd && (platform === 'win32' || platform === 'darwin')) base = base.toLowerCase();
  return `det_${crypto.createHash('sha1').update(`${base}|${Number(port)}`).digest('hex').slice(0, 10)}`;
}

module.exports = {
  classify, deriveProject, detectedAppId, resolveRelative, relativeTargets, candidateFolders,
  isLocalBinding, hostOf, procName, inspectorPorts, tokenize,
  OWN_PORTS, INSPECTOR_PORT,
};
