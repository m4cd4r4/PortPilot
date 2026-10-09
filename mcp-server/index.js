#!/usr/bin/env node
/**
 * PortPilot MCP Server v2.0
 *
 * Manage local development servers and ports via any MCP-compatible AI assistant.
 * Uses the high-level McpServer API from @modelcontextprotocol/sdk 1.x.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import os from 'os';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

// =============================================================================
// CONFIG
// =============================================================================

function getConfigPath() {
  // The desktop sets this when it shells out (Re-run), so a custom userData dir is honoured.
  if (process.env.PORTPILOT_CONFIG_PATH) return process.env.PORTPILOT_CONFIG_PATH;
  const platform = os.platform();
  let configDir;
  // NOTE: must match Electron's app.getPath('userData'), which is derived from
  // the lowercase package.json "name" ("portpilot"). Using "PortPilot" (capital)
  // here works on case-insensitive Windows but reads a DIFFERENT file on
  // Linux/macOS, so the MCP server would never see the desktop app's config.
  if (platform === 'win32') {
    configDir = path.join(process.env.APPDATA || '', 'portpilot');
  } else if (platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'portpilot');
  } else {
    configDir = path.join(os.homedir(), '.config', 'portpilot');
  }
  return path.join(configDir, 'portpilot-config.json');
}

// Core modules shared with the desktop app, agent and VS Code extension: the
// lock + atomic-write helpers (configFile) and the status/provenance model
// (status). Packaged builds ship a copy next to this file (electron-builder
// extraResources); from a repo checkout they are loaded from src/core.
const require = createRequire(import.meta.url);
function loadCore(name) {
  const candidates = [`./${name}.cjs`, `../src/core/${name}.js`];
  for (const p of candidates) {
    try { return require(p); } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; }
  }
  throw new Error(`PortPilot MCP: ${name} helper not found (expected ${candidates.join(' or ')})`);
}
const configFile = loadCore('configFile');
const status = loadCore('status');
const runHistory = loadCore('runHistory');
const emptyConfig = () => ({ apps: [], settings: {}, groups: [] });

function readConfig() {
  return configFile.readJson(getConfigPath(), emptyConfig);
}

// Locked read-modify-write; returns the mutator's result. The file is only
// rewritten if the mutator changed the config.
function updateConfig(mutator) {
  return configFile.updateJson(getConfigPath(), mutator, emptyConfig).result;
}

function generateId() {
  return `app_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// =============================================================================
// WORKTREE / BRANCH AWARENESS (Wave 3, Slice 11)
// =============================================================================

// Normalise a path for case-insensitive, slash-insensitive comparison - matches
// the desktop renderer / ipcHandlers cwd-matching so all clients agree.
function normPath(p) {
  return path.normalize(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * The registered app whose cwd is this directory, or null. Case folds only
 * where the default file system does (Windows, macOS): on Linux /a/Web and
 * /a/web are two projects.
 */
function cwdKey(p, platform = process.platform) {
  let s = path.normalize(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '');
  // Git Bash spells I:\x as /i/x (as the plugin's normPath reads it).
  if (platform === 'win32') s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`);
  return platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s;
}

function appAtCwd(apps, cwd, platform = process.platform) {
  return (apps || []).find(a => a && a.cwd && cwdKey(a.cwd, platform) === cwdKey(cwd, platform)) || null;
}

/**
 * A bash start as a command cmd.exe can run: leading `VAR=value` assignments
 * move to env, trailing redirections and `&` go. Kept in step with cmdSafe in
 * plugin/hooks/observe.mjs.
 */
function cmdSafe(raw) {
  let s = String(raw || '').trim().replace(/(^|[^&])&$/, '$1').trim();
  const env = {};
  const lead = shellWords(s);
  let i = 0;
  for (; i < lead.length - 1 && lead[i].bare && /^[A-Za-z_][A-Za-z0-9_]*=/.test(lead[i].raw); i++) {
    const name = lead[i].raw.slice(0, lead[i].raw.indexOf('='));
    env[name] = lead[i].text.slice(name.length + 1);
  }
  if (i) s = s.slice(lead[i].start);
  const cut = trailingShellOnly(shellWords(s));
  if (cut > 0) s = s.slice(0, cut);
  return { command: s.trim().replace(/[^\S\r\n]+/g, ' '), env };
}

/**
 * Bash words with their source span; `bare` when the word does not start quoted
 * or escaped; `ctl` when it holds an unquoted `;`, `|`, `(`, `)` or an `&`
 * that is not part of a redirection (`>&`, `<&`, `&>`). An unquoted line break is a
 * word of its own, with `ctl`.
 */
function shellWords(s) {
  const out = [];
  let cur = null, q = null;
  const close = (i) => { if (cur) { cur.end = i; out.push(cur); cur = null; } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!q && (ch === '\n' || ch === '\r')) { close(i); out.push({ start: i, end: i + 1, text: ch, bare: true, redirAt: -1, ctl: true }); continue; }
    if (!q && /\s/.test(ch)) { close(i); continue; }
    if (!cur) cur = { start: i, end: s.length, text: '', bare: !(ch === '"' || ch === "'" || ch === '\\'), redirAt: -1, ctl: false };
    if (!q && (ch === '>' || ch === '<') && cur.redirAt < 0) cur.redirAt = i - cur.start;
    if (!q && (/[;|()]/.test(ch) || (ch === '&' && s[i - 1] !== '>' && s[i - 1] !== '<' && s[i + 1] !== '>'))) cur.ctl = true;
    if (q) {
      if (ch === q) q = null;
      else if (q === '"' && ch === '\\' && i + 1 < s.length) cur.text += s[++i];
      else cur.text += ch;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '\\' && i + 1 < s.length) cur.text += s[++i];
    else cur.text += ch;
  }
  close(s.length);
  return out.map((w) => ({ ...w, raw: s.slice(w.start, w.end) }));
}

const REDIRECT = /^\d?(?:&>>?|>>?&?|<)/;

/**
 * Where a trailing run of redirections, `| tee ...` and `&` starts in s, or -1.
 * A `>` inside quotes is an argument; one glued to a word (`3000>x.log`) is a
 * redirection, as bash reads it. A `| tee` is trailing only when no word after
 * it chains another command (`;`, `&&`, `|`, `&`, a line break), glued or not.
 */
function trailingShellOnly(words) {
  const calm = new Array(words.length + 1).fill(true);
  for (let j = words.length - 1; j >= 0; j--) calm[j] = calm[j + 1] && !words[j].ctl;
  const teeAt = (k) => {
    const w = words[k];
    if (!w || !w.bare) return false;
    const from = w.raw === '|tee' ? k + 1 : w.raw === '|' && words[k + 1] && words[k + 1].text === 'tee' ? k + 2 : -1;
    return from >= 0 && calm[from];
  };
  // Past the redirection whose operator opens `head` (in word k), following a target
  // with its own glued redirection (`> x.log> y.log`); -1 when a target chains a command.
  const past = (k, head) => {
    for (;;) {
      const op = head.match(REDIRECT);
      if (!op) return -1;
      if (head.length > op[0].length) return k + 1;
      const t = words[k + 1];
      if (!t) return k + 1;
      if (t.ctl) return -1;
      if (!(t.redirAt > 0)) return k + 2;
      k += 1;
      head = t.raw.slice(t.redirAt);
    }
  };
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (teeAt(i)) return w.start;
    if (w.ctl) continue;
    const whole = w.bare && REDIRECT.test(w.raw);
    if (!whole && !(w.redirAt > 0)) continue;
    let k = past(i, whole ? w.raw : w.raw.slice(w.redirAt));
    if (k < 0) continue;
    while (k < words.length) {
      const x = words[k];
      const n = x.bare && !x.ctl && REDIRECT.test(x.raw) ? past(k, x.raw) : -1;
      if (n >= 0) k = n;
      else if (teeAt(k)) k = words.length;
      else if (x.bare && x.raw === '&' && k === words.length - 1) k += 1;
      else break;
    }
    if (k >= words.length) return whole ? w.start : w.start + w.redirAt;
    // Words inside i..k are operators and their targets, glued redirections followed
    // by past(); a start there would walk the same chain to the same break at k.
    i = Math.max(i, k - 1);
  }
  return -1;
}

/** A `<` or `>` outside double quotes: cmd.exe reads it as a redirection (it ignores single quotes). */
function cmdRedirects(command) {
  let q = false;
  for (const ch of String(command || '')) {
    if (ch === '"') q = !q;
    else if (!q && (ch === '<' || ch === '>')) return true;
  }
  return false;
}

/**
 * Why start_app will not run an app, or null. An observed app's command came
 * from bash; a redirection or a leading `VAR=` would run differently (or
 * write outside PortPilot's folders) under cmd.exe.
 */
function startRefusal(app) {
  if (!app || app.registeredBy !== 'observed') return null;
  const command = String(app.command || '').trim();
  const safe = cmdSafe(command);
  if (safe.command !== command.trim().replace(/[^\S\r\n]+/g, ' ')) {
    const env = Object.keys(safe.env).length ? ` and put ${JSON.stringify(safe.env)} in the app's env` : '';
    return `"${app.name}" was registered from a bash start and its command (${command}) has a shell redirection, a trailing & or a leading VAR= assignment, which cmd.exe would run differently. Fix it with update_app: command "${safe.command}"${env}.`;
  }
  if (cmdRedirects(command)) return `"${app.name}" was registered from a bash start and its command (${command}) has a < or > outside double quotes, which cmd.exe reads as a redirection. Fix the command with update_app (double-quote that argument).`;
  return null;
}

/**
 * The app an add_app call would duplicate, or null. An observation is
 * idempotent by directory: a second one (another session, a later start)
 * changes nothing. Any add of the same command in a directory already
 * registered is the same server too, so it is not copied either, unless it
 * runs on another port or with other env (a second instance). Commands
 * compare in their cmd-safe form (`npm run dev > x.log` is `npm run dev`).
 */
function observedDuplicate(apps, { cwd, command, registeredBy, env, preferredPort }, platform = process.platform) {
  const same = appAtCwd(apps, cwd, platform);
  if (!same) return null;
  if (registeredBy === 'observed') return same;
  const key = (cmd, extra, port) => {
    const safe = cmdSafe(cmd);
    const e = { ...safe.env, ...(extra || {}) };
    return JSON.stringify([safe.command, Object.keys(e).sort().map(k => [k, String(e[k])]), port || null]);
  };
  const want = key(command, env, preferredPort);
  return (apps || []).find(a => a && a.cwd && cwdKey(a.cwd, platform) === cwdKey(cwd, platform) && key(a.command, a.env, a.preferredPort) === want) || null;
}

// Deterministic colour from a seed (branch or path) so re-registering a worktree
// keeps its colour and sibling branches get distinct ones. Slice 10 will replace
// this with the Peacock window colour when present.
const WORKTREE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'];
function pickColor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return WORKTREE_COLORS[h % WORKTREE_COLORS.length];
}

// Resolve the git branch and the repo's PRIMARY worktree path for a directory.
// The primary worktree is the first entry of `git worktree list`. If `dir` is a
// linked worktree, mainWorktree differs from dir. Returns nulls for a non-repo.
function resolveWorktreeGit(dir) {
  const run = (cmd) => execSync(cmd, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const branch = run('git rev-parse --abbrev-ref HEAD') || null;
    let mainWorktree = null;
    try {
      const m = run('git worktree list --porcelain').match(/^worktree (.+)$/m);
      if (m) {
        mainWorktree = m[1].trim();
        // Canonicalise: git can return an 8.3 short path on Windows while the
        // registered app cwd is the long form, which would defeat the parent
        // match. realpath resolves both to the same canonical path.
        try { mainWorktree = fs.realpathSync.native(mainWorktree); } catch { /* keep raw */ }
      }
    } catch { /* old git or detached - branch alone is enough */ }
    const isWorktree = mainWorktree ? normPath(mainWorktree) !== normPath(dir) : false;
    return { branch, mainWorktree, isWorktree };
  } catch {
    return { branch: null, mainWorktree: null, isWorktree: false };
  }
}

// Pure registration logic: given the current config, the user input, and an
// already-resolved git result, upsert the worktree app (mutating config.apps)
// and return a structured result. No IO - this is what the unit test drives.
function registerWorktree(config, input, git, now) {
  const wtPath = input.path;
  if (!config.apps) config.apps = [];

  const resolvedBranch = input.branch || git.branch || null;

  // Parent: explicit (by id/name) wins; else match the main worktree to a
  // registered app's cwd. Never nest a worktree under itself.
  let parentApp = null;
  if (input.parent) {
    parentApp = config.apps.find(a => a.id === input.parent || (a.name || '').toLowerCase() === input.parent.toLowerCase()) || null;
    if (!parentApp) return { ok: false, error: `Parent app not found: ${input.parent}` };
  } else if (git.mainWorktree) {
    parentApp = config.apps.find(a => a.cwd && normPath(a.cwd) === normPath(git.mainWorktree)) || null;
  }
  if (parentApp && normPath(parentApp.cwd) === normPath(wtPath)) parentApp = null;

  const resolvedName = input.name || parentApp?.name || path.basename(wtPath);
  const resolvedCommand = input.command || parentApp?.command || 'npm run dev';

  // Upsert by cwd so re-registering a worktree updates instead of duplicating.
  const idx = config.apps.findIndex(a => a.cwd && normPath(a.cwd) === normPath(wtPath));
  const existing = idx >= 0 ? config.apps[idx] : null;

  const app = {
    ...(existing || {}),
    id: existing?.id || generateId(),
    name: resolvedName,
    command: resolvedCommand,
    cwd: wtPath,
    preferredPort: input.preferredPort ?? existing?.preferredPort ?? null,
    fallbackRange: existing?.fallbackRange ?? null,
    env: existing?.env ?? {},
    autoStart: existing?.autoStart ?? false,
    isFavorite: existing?.isFavorite ?? false,
    group: existing?.group ?? null,
    description: existing?.description ?? null,
    parentId: parentApp?.id || null,
    branch: resolvedBranch,
    worktreePath: wtPath,
    // An explicit colour (e.g. the VS Code window's Peacock colour, passed by
    // wt-mint) wins and is tagged so a later manual change can be respected.
    colorSource: input.colorSource ?? existing?.colorSource ?? null,
    color: input.color || existing?.color || pickColor(resolvedBranch || wtPath),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (idx >= 0) config.apps[idx] = app; else config.apps.push(app);

  const notes = [];
  if (!parentApp) notes.push('No registered parent project found - registered as a standalone app. Register the main repo or pass `parent` so this nests under it.');
  if (parentApp && app.preferredPort && parentApp.preferredPort === app.preferredPort) notes.push(`Port ${app.preferredPort} matches the parent's preferred port - they will collide if both run. Pick a different port.`);
  if (!git.branch && !input.branch) notes.push('Could not detect a git branch for this path - no branch label set.');

  return {
    ok: true,
    action: idx >= 0 ? 'updated' : 'added',
    app,
    parent: parentApp ? { id: parentApp.id, name: parentApp.name } : null,
    branch: resolvedBranch,
    notes,
  };
}

// =============================================================================
// PORT SCANNING
// =============================================================================

function getProcessNamesWindows(pids) {
  // Single batched PID -> image-name lookup. Replaces a per-PID `wmic` spawn
  // (slow, and `wmic` is deprecated/removed on recent Windows 11). `tasklist`
  // image names are locale-independent.
  const map = new Map();
  if (pids.length === 0) return map;
  try {
    const out = execSync('tasklist /fo csv /nh', { encoding: 'utf-8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    const wanted = new Set(pids);
    for (const line of out.split('\n')) {
      const cols = line.split('","').map(c => c.replace(/^"|"$/g, '').trim());
      if (cols.length < 2) continue;
      const pid = parseInt(cols[1], 10);
      if (wanted.has(pid)) map.set(pid, cols[0]);
    }
  } catch { /* names stay Unknown */ }
  return map;
}

function scanPorts() {
  const platform = os.platform();
  const ports = [];

  try {
    if (platform === 'win32') {
      const output = execSync('netstat -ano', { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
      const lines = output.split('\n').filter(l => /^\s*TCP\b/i.test(l));

      const portToPid = new Map();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const foreignPart = parts[2];
        if (!foreignPart || !foreignPart.match(/:0$/)) continue;
        const portMatch = parts[1].match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = parseInt(portMatch[1]);
        const pid = parseInt(parts[4], 10);
        if (port >= 1 && port <= 65535 && !portToPid.has(port)) {
          portToPid.set(port, pid);
        }
      }

      const names = getProcessNamesWindows([...new Set(portToPid.values())]);
      for (const [port, pid] of portToPid) {
        ports.push({ port, pid, processName: names.get(pid) || 'Unknown' });
      }
    } else if (platform === 'darwin') {
      const output = execSync('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf-8', timeout: 10000 });
      for (const line of output.split('\n').slice(1)) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const portMatch = parts[8]?.match(/:(\d+)$/);
          if (portMatch) {
            ports.push({ port: parseInt(portMatch[1]), pid: parseInt(parts[1]), processName: parts[0] });
          }
        }
      }
    } else {
      let output;
      try { output = execSync('ss -tlnp', { encoding: 'utf-8', timeout: 10000 }); }
      catch { output = execSync('netstat -tlnp', { encoding: 'utf-8', timeout: 10000 }); }
      for (const line of output.split('\n')) {
        const portMatch = line.match(/:(\d+)\s/);
        const pidMatch = line.match(/pid=(\d+)/);
        if (portMatch) {
          ports.push({ port: parseInt(portMatch[1]), pid: pidMatch ? parseInt(pidMatch[1]) : null, processName: 'Unknown' });
        }
      }
    }
  } catch (error) {
    console.error('Port scan error:', error.message);
  }

  return [...new Map(ports.map(p => [p.port, p])).values()].sort((a, b) => a.port - b.port);
}

function checkPort(port) {
  const all = scanPorts();
  return all.find(p => p.port === port) || null;
}

function killPort(port) {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      // Resolve the PID via the locale-independent scan rather than
      // `findstr LISTENING`, which fails on non-English Windows.
      const match = scanPorts().find(p => p.port === port);
      if (!match || !match.pid) return { success: false, error: 'Port not found' };
      execSync(`taskkill /F /PID ${match.pid}`);
      return { success: true, pid: match.pid };
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`);
      return { success: true };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// APP OPERATIONS
// =============================================================================

function findApp(apps, identifier) {
  return apps.find(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
}

/** Resolve PID -> command line for a set of PIDs (used for accurate matching). */
function getCommandLines(pids) {
  const map = new Map();
  if (!pids.length) return map;
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      const filter = pids.map(p => `ProcessId=${p}`).join(' or ');
      const out = execSync(
        `powershell -NoProfile -NonInteractive -Command ` +
        `"Get-CimInstance Win32_Process -Filter '${filter}' | ` +
        `Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"`,
        { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }
      );
      let data = JSON.parse(out);
      if (!Array.isArray(data)) data = [data];
      for (const proc of data) {
        const pid = parseInt(proc.ProcessId, 10);
        if (pid) map.set(pid, proc.CommandLine || '');
      }
    } else {
      const out = execSync(`ps -o pid=,command= -p ${pids.join(',')}`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (m) map.set(parseInt(m[1], 10), m[2]);
      }
    }
  } catch { /* command lines optional - matching falls back to port */ }
  return map;
}

/**
 * Map apps -> the port they're actually running on.
 * Mirrors the desktop app's two-phase logic so apps without a preferredPort, or
 * running on a dynamic port, are still detected (the old code only matched an
 * exact preferredPort, so those always read "stopped").
 */
function computeRunning(apps, activePorts) {
  const pids = [...new Set(activePorts.map(p => p.pid).filter(Boolean))];
  const cmds = getCommandLines(pids);
  const ports = activePorts.map(p => ({ ...p, commandLine: cmds.get(p.pid) || '' }));
  const matched = new Set();
  const result = new Map();

  // Phase 1: high-confidence CWD match in the command line.
  for (const app of apps) {
    if (!app.cwd) continue;
    const cwd = app.cwd.toLowerCase();
    const cwdAlt = cwd.replace(/\\/g, '/');
    for (const p of ports) {
      if (matched.has(p.port)) continue;
      const cl = p.commandLine.toLowerCase();
      if (cl && (cl.includes(cwd) || cl.includes(cwdAlt))) {
        result.set(app.id, p);
        matched.add(p.port);
        break;
      }
    }
    if (result.has(app.id)) continue;
    // Folder-name / app-name keyword evidence on any unmatched port.
    const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || '';
    const keywords = [folder, ...app.name.toLowerCase().split(/[^a-z0-9]+/)].filter(k => k.length > 3);
    for (const p of ports) {
      if (matched.has(p.port)) continue;
      const cl = p.commandLine.toLowerCase();
      if (cl && keywords.some(k => cl.includes(k))) {
        result.set(app.id, p);
        matched.add(p.port);
        break;
      }
    }
  }

  // Phase 2: explicit preferredPort match (config is a strong signal).
  for (const app of apps) {
    if (result.has(app.id) || !app.preferredPort) continue;
    const p = ports.find(x => x.port === app.preferredPort);
    if (!p || matched.has(p.port)) continue;
    result.set(app.id, p);
    matched.add(p.port);
  }

  return result;
}

function getRunningStatus(apps, activePorts) {
  const running = computeRunning(apps, activePorts);
  return apps.map(app => {
    const p = running.get(app.id) || null;
    return {
      id: app.id,
      name: app.name,
      command: app.command,
      cwd: app.cwd,
      preferredPort: app.preferredPort,
      detectedPort: p ? p.port : null,
      isFavorite: app.isFavorite,
      autoStart: app.autoStart,
      group: app.group || null,
      description: app.description || null,
      running: !!p,
      pid: p?.pid || null,
      processName: p?.processName || null
    };
  });
}

/**
 * Truncate (creating its folder) the log a detached start writes to. Returns
 * the path, or null when the file cannot be opened - e.g. a leftover process
 * from an earlier run still holds it on Windows, where a shell redirect to a
 * held file aborts the command. The app then starts without a log.
 */
function prepareLog(logPath) {
  if (!logPath) return null;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '');
    return logPath;
  } catch {
    return null;
  }
}

/**
 * The shell line that starts `command` detached, its stdout and stderr going to
 * `logPath` (or discarded when null). On Windows the redirect binds to the
 * last command of a `&&` chain, which is the long-running server in a
 * `cd x && npm run dev`; POSIX runs the whole line under sh -c.
 */
function detachedCommand(platform, command, logPath) {
  if (platform === 'win32') {
    const out = logPath ? `"${logPath}"` : 'NUL';
    return `start /B cmd /c "${command} > ${out} 2>&1"`;
  }
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  return `nohup sh -c ${q(command)} > ${logPath ? q(logPath) : '/dev/null'} 2>&1 &`;
}

/**
 * Start an app and report an HONEST result. When the app has a preferredPort we
 * poll for it to come up (so a command that fails immediately reports failure
 * instead of a misleading success). Without a port we can only confirm the
 * shell spawned, and say so.
 */
function startApp(app, logPath = null) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; resolve(res); } };
    try {
      const env = { ...process.env, ...app.env };
      if (app.preferredPort) env.PORT = String(app.preferredPort);

      const options = { cwd: app.cwd, env, detached: true, stdio: 'ignore', shell: true, windowsHide: true };
      const child = exec(detachedCommand(os.platform(), app.command, prepareLog(logPath)), options);

      child.on('error', (err) => done({ success: false, error: err.message }));
      if (typeof child.unref === 'function') child.unref();

      if (app.preferredPort) {
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          if (checkPort(app.preferredPort)) {
            clearInterval(iv);
            done({ success: true, verified: true, message: `Started ${app.name}; port ${app.preferredPort} is up` });
          } else if (tries >= 6) {
            clearInterval(iv);
            done({ success: false, verified: true, error: `Started ${app.name} but port ${app.preferredPort} never came up within ~6s - check the command, cwd, or its logs` });
          }
        }, 1000);
      } else {
        // No port to verify against; just catch an immediate spawn failure.
        setTimeout(() => done({ success: true, verified: false, message: `Started ${app.name} (unverified - no preferredPort set to confirm it bound)` }), 800);
      }
    } catch (error) {
      done({ success: false, error: error.message });
    }
  });
}

/**
 * An app whose port is already listening is running: starting it again cannot
 * bind, yet checkPort would see the OLD process and report success, which would
 * stamp a start (and open a run) for a process Claude never launched.
 */
function alreadyRunning(app, check = checkPort) {
  if (!app.preferredPort || !check(app.preferredPort)) return null;
  return { success: true, alreadyRunning: true, verified: true, message: `${app.name} is already running on port ${app.preferredPort}; left as it is` };
}

/**
 * Record that Claude started `app` through this server, so every surface shows
 * "claude <session>". Best-effort: returns false (never throws) on a bad
 * session id or a failed write - the start itself already succeeded.
 */
function stampStart(configPath, app, sessionId) {
  if (!app || !app.id) return false;
  let startedBy;
  try {
    startedBy = status.makeStartedBy({ kind: 'claude', surface: 'mcp', sessionId });
  } catch {
    return false;
  }
  return configFile.recordStart(configPath, app.id, startedBy, { port: app.preferredPort });
}

function stopApp(app) {
  const activePorts = scanPorts();
  const portInfo = activePorts.find(p => p.port === app.preferredPort);

  if (portInfo?.pid) {
    try {
      if (os.platform() === 'win32') {
        execSync(`taskkill /F /PID ${portInfo.pid}`);
      } else {
        execSync(`kill -9 ${portInfo.pid}`);
      }
      return { success: true, message: `Stopped ${app.name} (PID: ${portInfo.pid})` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  if (app.preferredPort) return killPort(app.preferredPort);
  return { success: false, error: 'Could not find running process' };
}

// =============================================================================
// RUN HISTORY (find_run)
// =============================================================================

const FIND_RUN_DEFAULT = 5;
const FIND_RUN_MAX = 20;

/**
 * Filter and rank run records, newest first. Pure: the caller adds `running`
 * and `rerun`. `since`/`until` are ISO strings (inclusive).
 */
function findRuns(runs, { query, app, branch, since, until, dirty_only, limit } = {}) {
  const lower = (v) => String(v || '').toLowerCase();
  const terms = lower(query).split(/\s+/).filter(Boolean);
  // Every term must hit somewhere. A sha only matches from its start, so a
  // short hex fragment from the middle of one does not pull in stray runs.
  const textOf = (r) => lower([
    r.appName, r.command, r.git && r.git.branch, r.git && r.git.subject,
    r.page && r.page.title, ...((r.git && r.git.files) || []),
  ].join('\n'));
  // A date-only bound is a LOCAL calendar day (the server runs on the user's
  // machine): since = its first moment, until = its last. Date.parse alone
  // reads it as midnight UTC, which drops a whole day for anyone off UTC.
  const bound = (v, endOfDay) => {
    if (!v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
    if (!m) return Date.parse(v);
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (endOfDay) day.setDate(day.getDate() + 1);
    return day.getTime() - (endOfDay ? 1 : 0);
  };
  const sinceMs = bound(since, false);
  const untilMs = bound(until, true);
  const matched = runs.filter((r) => {
    const started = Date.parse(r.startedAt);
    if ((sinceMs !== null || untilMs !== null) && Number.isNaN(started)) return false;
    if (app && r.appId !== app && lower(r.appName) !== lower(app)) return false;
    if (branch && !lower(r.git && r.git.branch).includes(lower(branch))) return false;
    if (sinceMs !== null && started < sinceMs) return false;
    if (untilMs !== null && started > untilMs) return false;
    if (dirty_only && !(r.git && r.git.dirty)) return false;
    if (terms.length) {
      const text = textOf(r);
      const sha = lower(r.git && r.git.sha);
      if (!terms.every((t) => text.includes(t) || (sha && sha.startsWith(t)))) return false;
    }
    return true;
  });
  matched.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const n = Math.min(Math.max(Math.floor(Number(limit)) || FIND_RUN_DEFAULT, 1), FIND_RUN_MAX);
  const page = matched.slice(0, n);
  return { count: page.length, total: matched.length, runs: page };
}

const LOCKFILE_INSTALL = [
  ['package-lock.json', 'npm ci'],
  ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile'],
  ['yarn.lock', 'yarn install --frozen-lockfile'],
  ['bun.lockb', 'bun install --frozen-lockfile'],
  ['bun.lock', 'bun install --frozen-lockfile'],
];

/**
 * The literal commands that bring a run back: a detached worktree at the
 * snapshot (or the commit, for a clean tree), a lockfile install, the start
 * command. Claude runs them with its own tools or asks the user to press
 * Re-run. \`exists\` is injectable for tests.
 */
function rerunSteps(run, exists = fs.existsSync) {
  const fwd = (p) => String(p).replace(/\\/g, '/');
  const start = run.command || '';
  const inPlace = run.cwd ? [`cd "${fwd(run.cwd)}" && ${start}`] : [start];
  if (!run.git) {
    return { steps: inPlace, note: 'Git state was not captured for this run (the capture had not finished or failed); this starts whatever is in the folder now.' };
  }
  if (!run.repoRoot || !run.git.sha) {
    return { steps: inPlace, note: 'Not a git repository (or no commits yet), so the files cannot be restored; this starts whatever is in the folder now.' };
  }
  const root = fwd(run.repoRoot);
  const rel = run.relCwd ? fwd(run.relCwd) : '';
  const wt = `${root}-run-${String(run.id).replace(/^r_/, '')}`;
  const target = run.git.snapshot ? run.git.snapshot.ref : run.git.sha;
  const steps = [`git -C "${root}" worktree add --detach "${wt}" ${target}`];

  const dirs = [rel, ''].filter((d, i, a) => a.indexOf(d) === i);
  const at = (d, file) => [root, d, file].filter(Boolean).join('/');
  let install = null;
  for (const d of dirs) {
    const hit = LOCKFILE_INSTALL.find(([file]) => exists(at(d, file)));
    if (hit) { install = { d, cmd: hit[1] }; break; }
  }
  if (!install) {
    const d = dirs.find((dir) => exists(at(dir, 'package.json')));
    if (d !== undefined) install = { d, cmd: 'npm install' };
  }
  const inWt = (d) => `cd "${[wt, d].filter(Boolean).join('/')}"`;
  if (install) steps.push(`${inWt(install.d)} && ${install.cmd}`);
  steps.push(`${inWt(rel)} && ${start}`);

  const out = { steps };
  if (run.git.dirty && !run.git.snapshot) {
    out.note = `Uncommitted changes were not captured (skipped: ${run.git.skipped || 'unknown'}); this reproduces the commit only.`;
  }
  return out;
}

// =============================================================================
// MCP SERVER
// =============================================================================

function createServer() {
  const server = new McpServer({
    name: 'portpilot',
    version: '3.5.0',
  });

  // --- Status ---

  server.tool(
    'get_status',
    'Get a quick summary: how many apps registered, how many running, how many ports active',
    {},
    async () => {
      const config = readConfig();
      const ports = scanPorts();
      const apps = config.apps || [];
      const running = computeRunning(apps, ports);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            registeredApps: apps.length,
            runningApps: running.size,
            activePorts: ports.length,
            favorites: apps.filter(a => a.isFavorite).length,
            groups: (config.groups || []).length
          }, null, 2)
        }]
      };
    }
  );

  // --- List Apps ---

  server.tool(
    'list_apps',
    'List all apps registered in PortPilot, with their running status',
    {
      favorites_only: z.boolean().optional().describe('Only show favorite apps'),
      group: z.string().optional().describe('Filter by group name')
    },
    async ({ favorites_only, group }) => {
      const config = readConfig();
      const ports = scanPorts();
      let apps = getRunningStatus(config.apps || [], ports);

      if (favorites_only) apps = apps.filter(a => a.isFavorite);
      if (group) apps = apps.filter(a => a.group === group);

      return {
        content: [{ type: 'text', text: JSON.stringify({ count: apps.length, apps }, null, 2) }]
      };
    }
  );

  // --- Get App ---

  server.tool(
    'get_app',
    'Get full details of a specific app by ID or name, including running status',
    { identifier: z.string().describe('App ID or name') },
    async ({ identifier }) => {
      const config = readConfig();
      const app = findApp(config.apps || [], identifier);
      if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };

      const ports = scanPorts();
      const status = getRunningStatus([app], ports)[0];
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  // --- Scan Ports ---

  server.tool(
    'scan_ports',
    'Scan for all active listening ports on the system',
    {
      min_port: z.number().optional().describe('Minimum port (default 1024)'),
      max_port: z.number().optional().describe('Maximum port (default 65535)')
    },
    async ({ min_port, max_port }) => {
      let ports = scanPorts();
      ports = ports.filter(p => p.port >= (min_port || 1024) && p.port <= (max_port || 65535));
      return { content: [{ type: 'text', text: JSON.stringify({ count: ports.length, ports }, null, 2) }] };
    }
  );

  // --- Check Port ---

  server.tool(
    'check_port',
    'Check if a specific port is in use and by what process',
    { port: z.number().describe('Port number to check') },
    async ({ port }) => {
      const info = checkPort(port);
      if (!info) {
        return { content: [{ type: 'text', text: JSON.stringify({ port, inUse: false }, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ port, inUse: true, ...info }, null, 2) }] };
    }
  );

  // --- Start App ---

  server.tool(
    'start_app',
    'Start an app by ID or name',
    {
      identifier: z.string().describe('App ID or name'),
      sessionId: z.string().max(200).optional().describe('Leave unset. The PortPilot plugin fills in the real session id; a guessed one hides crash alerts from this session')
    },
    async ({ identifier, sessionId }) => {
      const config = readConfig();
      const app = findApp(config.apps || [], identifier);
      if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
      const refused = startRefusal(app);
      if (refused) return { content: [{ type: 'text', text: refused }], isError: true };
      const up = alreadyRunning(app);
      const result = up || await startApp(app, configFile.logPathFor(getConfigPath(), app.id));
      if (result.success && !up) stampStart(getConfigPath(), app, sessionId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.success };
    }
  );

  // --- Stop App ---

  server.tool(
    'stop_app',
    'Stop an app by ID or name',
    { identifier: z.string().describe('App ID or name') },
    async ({ identifier }) => {
      const config = readConfig();
      const app = findApp(config.apps || [], identifier);
      if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
      const result = stopApp(app);
      if (result.success) configFile.recordStop(getConfigPath(), app.id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.success };
    }
  );

  // --- Bulk Start ---

  server.tool(
    'bulk_start',
    'Start multiple apps at once by group name, or all favorites',
    {
      group: z.string().optional().describe('Start all apps in this group'),
      favorites: z.boolean().optional().describe('Start all favorite apps'),
      sessionId: z.string().max(200).optional().describe('Leave unset. The PortPilot plugin fills in the real session id; a guessed one hides crash alerts from this session')
    },
    async ({ group, favorites, sessionId }) => {
      const config = readConfig();
      let apps = config.apps || [];

      if (group) apps = apps.filter(a => a.group === group);
      else if (favorites) apps = apps.filter(a => a.isFavorite);
      else return { content: [{ type: 'text', text: 'Specify group or favorites: true' }], isError: true };

      const results = await Promise.all(apps.map(async a => {
        const refused = startRefusal(a);
        if (refused) return { name: a.name, success: false, error: refused };
        const up = alreadyRunning(a);
        const result = up || await startApp(a, configFile.logPathFor(getConfigPath(), a.id));
        if (result.success && !up) stampStart(getConfigPath(), a, sessionId);
        return { name: a.name, ...result };
      }));
      const ok = results.filter(r => r.success).length;
      return { content: [{ type: 'text', text: JSON.stringify({ attempted: results.length, succeeded: ok, results }, null, 2) }] };
    }
  );

  // --- Bulk Stop ---

  server.tool(
    'bulk_stop',
    'Stop multiple apps at once by group name, or all favorites, or all running',
    {
      group: z.string().optional().describe('Stop all apps in this group'),
      favorites: z.boolean().optional().describe('Stop all favorite apps'),
      all: z.boolean().optional().describe('Stop ALL running apps')
    },
    async ({ group, favorites, all }) => {
      const config = readConfig();
      let apps = config.apps || [];

      if (group) apps = apps.filter(a => a.group === group);
      else if (favorites) apps = apps.filter(a => a.isFavorite);
      else if (!all) return { content: [{ type: 'text', text: 'Specify group, favorites: true, or all: true' }], isError: true };

      const ports = scanPorts();
      const running = apps.filter(a => a.preferredPort && ports.some(p => p.port === a.preferredPort));
      const results = running.map(a => {
        const result = stopApp(a);
        if (result.success) configFile.recordStop(getConfigPath(), a.id);
        return { name: a.name, ...result };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ stopped: results.length, results }, null, 2) }] };
    }
  );

  // --- Add App ---

  server.tool(
    'add_app',
    'Register a new app in PortPilot. When PortPilot tells you a port started listening after a dev-server start you ran (a "PortPilot: :<port> started listening after ..." note), and you are confident your own start opened that port (check the PID and process it names), call this with the cwd, command and env it suggests, preferredPort set to that port and registeredBy "observed". Never register a port held by a process you did not start. Observed registrations are idempotent per directory: a second call for the same cwd changes nothing.',
    {
      name: z.string().describe('App display name'),
      command: z.string().describe('Shell command to start (e.g. "npm run dev")'),
      cwd: z.string().describe('Working directory path'),
      preferredPort: z.number().optional().describe('Preferred port number'),
      isFavorite: z.boolean().optional().describe('Mark as favorite'),
      autoStart: z.boolean().optional().describe('Auto-start on launch'),
      group: z.string().optional().describe('Group name to assign to'),
      description: z.string().optional().describe('Short description'),
      env: z.record(z.string()).optional().describe('Environment variables for the command (e.g. {"PORT":"4000"})'),
      registeredBy: z.enum(['observed']).optional().describe('"observed" when registering a server you started after PortPilot noted its new port; leave unset otherwise'),
      observedSession: z.string().optional().describe('The Claude Code session the observed start came from (the PortPilot plugin fills this in)')
    },
    async ({ name, command, cwd, preferredPort, isFavorite, autoStart, group, description, env, registeredBy, observedSession }) => {
      // An observed command came from bash: save it in the form cmd.exe runs.
      if (registeredBy === 'observed') {
        const safe = cmdSafe(command);
        command = safe.command;
        env = { ...safe.env, ...(env || {}) };
      }
      return updateConfig((config) => {
        if (!config.apps) config.apps = [];

        const same = observedDuplicate(config.apps, { cwd, command, registeredBy, env, preferredPort });
        if (same) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, existing: true, message: `"${same.name}" is already registered for ${cwd}`, app: same }, null, 2) }] };
        }

        if (config.apps.some(a => a.name.toLowerCase() === name.toLowerCase())) {
          return { content: [{ type: 'text', text: `App "${name}" already exists` }], isError: true };
        }

        const now = new Date().toISOString();
        const newApp = {
          id: generateId(), name, command, cwd,
          preferredPort: preferredPort || null,
          fallbackRange: null, env: env || {},
          autoStart: autoStart || false,
          isFavorite: isFavorite || false,
          group: group || null,
          description: description || null,
          color: '#4fc3f7',
          ...(registeredBy ? { registeredBy, observedSession: observedSession || null, observedAt: now } : {}),
          createdAt: now, updatedAt: now
        };

        config.apps.push(newApp);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Added "${name}"`, app: newApp }, null, 2) }] };
      });
    }
  );

  // --- Add Worktree / Branch ---

  server.tool(
    'add_worktree',
    'Register a git worktree or branch of a project so it appears nested under the main project in PortPilot and can run on its own port alongside it. Auto-detects the branch and the parent repo from git. Use this instead of add_app when registering a branch/worktree of an already-registered project - e.g. when working in a worktree that runs on a different port than the configured one.',
    {
      path: z.string().describe('Absolute path to the worktree / branch working directory'),
      command: z.string().optional().describe('Start command; defaults to the parent app command or "npm run dev"'),
      preferredPort: z.number().optional().describe('Preferred port for this branch - use a DIFFERENT port than the parent so both can run'),
      branch: z.string().optional().describe('Branch label shown on the row; auto-detected from git if omitted'),
      parent: z.string().optional().describe('Parent app id or name to nest under; auto-resolved from the repo\'s main worktree if omitted'),
      name: z.string().optional().describe('Display name; defaults to the parent name or the folder name'),
    },
    async ({ path: wtPath, command, preferredPort, branch, parent, name }) => {
      if (!fs.existsSync(wtPath)) {
        return { content: [{ type: 'text', text: `Path does not exist: ${wtPath}` }], isError: true };
      }
      const git = resolveWorktreeGit(wtPath); // shells out to git - keep it outside the lock
      return updateConfig((config) => {
        const result = registerWorktree(config, { path: wtPath, command, preferredPort, branch, parent, name }, git, new Date().toISOString());
        if (!result.ok) {
          return { content: [{ type: 'text', text: result.error }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      });
    }
  );

  // --- Update App ---

  server.tool(
    'update_app',
    'Update an existing app configuration',
    {
      identifier: z.string().describe('App ID or name to update'),
      name: z.string().optional(),
      command: z.string().optional(),
      cwd: z.string().optional(),
      preferredPort: z.number().optional(),
      isFavorite: z.boolean().optional(),
      autoStart: z.boolean().optional(),
      group: z.string().optional(),
      description: z.string().optional(),
      env: z.record(z.string()).optional().describe('Environment variables for the command; replaces the saved set')
    },
    async ({ identifier, ...updates }) => {
      return updateConfig((config) => {
        const idx = (config.apps || []).findIndex(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
        if (idx === -1) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };

        // Remove undefined values
        const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
        config.apps[idx] = { ...config.apps[idx], ...clean, updatedAt: new Date().toISOString() };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, app: config.apps[idx] }, null, 2) }] };
      });
    }
  );

  // --- Delete App ---

  server.tool(
    'delete_app',
    'Remove an app from PortPilot',
    { identifier: z.string().describe('App ID or name to delete') },
    async ({ identifier }) => {
      return updateConfig((config) => {
        const idx = (config.apps || []).findIndex(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
        if (idx === -1) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
        const deleted = config.apps.splice(idx, 1)[0];
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: deleted.name }, null, 2) }] };
      });
    }
  );

  // --- Delete All Apps ---

  server.tool(
    'delete_all_apps',
    'Delete ALL apps from PortPilot. Requires confirm: true.',
    { confirm: z.boolean().describe('Must be true to confirm') },
    async ({ confirm }) => {
      if (!confirm) return { content: [{ type: 'text', text: 'Pass confirm: true to delete all apps' }], isError: true };
      return updateConfig((config) => {
        const count = (config.apps || []).length;
        const names = (config.apps || []).map(a => a.name);
        config.apps = [];
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: count, names }, null, 2) }] };
      });
    }
  );

  // --- Kill Port ---

  server.tool(
    'kill_port',
    'Kill the process running on a specific port',
    { port: z.number().describe('Port number') },
    async ({ port }) => {
      const result = killPort(port);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.success };
    }
  );

  // --- Toggle Favorite ---

  server.tool(
    'toggle_favorite',
    'Toggle favorite status of an app',
    { identifier: z.string().describe('App ID or name') },
    async ({ identifier }) => {
      return updateConfig((config) => {
        const app = findApp(config.apps || [], identifier);
        if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
        app.isFavorite = !app.isFavorite;
        app.updatedAt = new Date().toISOString();
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, name: app.name, isFavorite: app.isFavorite }, null, 2) }] };
      });
    }
  );

  // --- List Groups ---

  server.tool(
    'list_groups',
    'List all app groups and how many apps are in each',
    {},
    async () => {
      const config = readConfig();
      const groups = config.groups || [];
      const apps = config.apps || [];

      const result = groups.map(g => ({
        id: g.id,
        name: g.name,
        color: g.color,
        appCount: apps.filter(a => a.group === g.id).length
      }));

      // Count ungrouped
      const ungrouped = apps.filter(a => !a.group).length;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ groups: result, ungroupedApps: ungrouped }, null, 2)
        }]
      };
    }
  );

  // --- Move to Group ---

  server.tool(
    'move_to_group',
    'Move an app to a group (or remove from group by passing null)',
    {
      identifier: z.string().describe('App ID or name'),
      group: z.string().nullable().describe('Group ID or name, or null to ungroup')
    },
    async ({ identifier, group }) => {
      return updateConfig((config) => {
        const app = findApp(config.apps || [], identifier);
        if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };

        if (group) {
          // Resolve group by name if not an ID
          const resolved = (config.groups || []).find(g => g.id === group || g.name.toLowerCase() === group.toLowerCase());
          if (!resolved) return { content: [{ type: 'text', text: `Group not found: ${group}` }], isError: true };
          app.group = resolved.id;
        } else {
          app.group = null;
        }

        app.updatedAt = new Date().toISOString();
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, name: app.name, group: app.group }, null, 2) }] };
      });
    }
  );

  // --- List Running (convenience) ---

  server.tool(
    'list_running',
    'List only currently running apps with their port and process info',
    {},
    async () => {
      const config = readConfig();
      const ports = scanPorts();
      const all = getRunningStatus(config.apps || [], ports);
      const running = all.filter(a => a.running);
      return { content: [{ type: 'text', text: JSON.stringify({ count: running.length, apps: running }, null, 2) }] };
    }
  );

  // --- Find Run (run history) ---

  server.tool(
    'find_run',
    'Find past runs of your apps: which version was running when, on which branch, with what uncommitted files. Every start, stop and crash is recorded locally with a git snapshot of the tree (uncommitted and untracked files included). Use it for "which version of the mockup was running on Monday" or "get back the checkout page from last week". Returns newest first; each run carries rerun.steps, the literal commands (git worktree add, install, start) that bring that version back.',
    {
      query: z.string().max(200).optional().describe('Free text, every word must match: app name, branch, page title, changed file names, command, commit subject, or the start of a commit sha'),
      app: z.string().optional().describe('App id or name'),
      branch: z.string().optional().describe('Branch name or part of it'),
      since: z.string().optional().describe('ISO date (a whole local day, from its start) or date-time with offset. Resolve words like "Monday" to a date in the user\'s time zone first'),
      until: z.string().optional().describe('ISO date (a whole local day, to its end) or date-time with offset, inclusive'),
      dirty_only: z.boolean().optional().describe('Only runs that had uncommitted changes'),
      limit: z.number().int().min(1).optional().describe(`How many runs to return (default ${FIND_RUN_DEFAULT}, max ${FIND_RUN_MAX})`)
    },
    async (filters) => {
      for (const key of ['since', 'until']) {
        if (filters[key] && Number.isNaN(Date.parse(filters[key]))) {
          return { content: [{ type: 'text', text: `${key} is not a date: ${filters[key]}. Use an ISO date such as 2026-10-05 or 2026-10-05T09:00:00+08:00` }], isError: true };
        }
      }
      const found = findRuns(runHistory.readRuns(getConfigPath()), filters);
      const listening = new Set(scanPorts().map(p => p.port));
      const runs = found.runs.map(r => ({
        ...r,
        // Open and still on its port. A record left open by a process that died unseen is not running.
        running: !r.stoppedAt && !!r.port && listening.has(r.port),
        rerun: rerunSteps(r)
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ count: runs.length, total: found.total, runs }, null, 2) }] };
    }
  );
  return server;
}

// =============================================================================
// START
// =============================================================================

// Shared HTTP mode: one process serves many MCP clients (one Claude session each),
// each getting its own McpServer instance keyed by session id. Avoids the
// stdio model where every session spawns its own server process.
async function startHttp(port, host) {
  const transports = {};

  // Same Host/Origin allowlists as the web agent (src/agent/server.js). Without
  // them a web page can DNS-rebind to this port and call add_app + start_app,
  // i.e. run any command. MCP clients send no Origin; browsers always do.
  const loopback = [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedHosts = new Set(loopback);
  const allowedOrigins = new Set(loopback.map((h) => `http://${h}`));

  const httpServer = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url !== '/mcp') {
      res.writeHead(404).end('Not found');
      return;
    }

    const origin = req.headers.origin;
    if (!allowedHosts.has((req.headers.host || '').toLowerCase()) ||
        (origin !== undefined && !allowedOrigins.has(origin.toLowerCase()))) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let body;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
        return;
      }
    }

    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports[sessionId] : undefined;

    if (!transport) {
      if (req.method === 'POST' && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { transports[id] = transport; },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
        await createServer().connect(transport);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session ID' }, id: null }));
        return;
      }
    }

    await transport.handleRequest(req, res, body);
  });

  httpServer.on('error', (err) => {
    console.error(`PortPilot MCP HTTP server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') process.exit(1);
  });

  httpServer.listen(port, host, () => {
    console.error(`PortPilot MCP Server (http) on http://${host}:${port}/mcp`);
  });
}

// Minimal --flag value parser for the register-worktree CLI.
function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    out[key] = (next && !next.startsWith('--')) ? args[++i] : 'true';
  }
  return out;
}

// `node index.js register-worktree --path <dir> [--branch] [--port] [--color]
// [--parent] [--name] [--command]` - lets wt-mint.sh (and any script) register a
// worktree in PortPilot without an MCP round-trip. Reuses the same tested logic
// as the add_worktree tool and writes the shared config the desktop app watches.
function runRegisterWorktreeCli(args) {
  const f = parseFlags(args);
  if (!f.path) { console.error('register-worktree: --path is required'); process.exit(64); }
  if (!fs.existsSync(f.path)) { console.error(`register-worktree: path does not exist: ${f.path}`); process.exit(66); }
  const git = resolveWorktreeGit(f.path);
  // Exit only after updateConfig returns - process.exit inside the mutator
  // would skip the lock release.
  const result = updateConfig((config) => registerWorktree(config, {
    path: f.path,
    branch: f.branch,
    parent: f.parent,
    name: f.name,
    command: f.command,
    preferredPort: f.port ? parseInt(f.port, 10) : undefined,
    color: f.color,
    colorSource: f.color ? 'peacock' : undefined,
  }, git, new Date().toISOString()));
  if (!result.ok) { console.error(result.error); process.exit(1); }
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'register-worktree') return runRegisterWorktreeCli(args.slice(1));
  const portIdx = args.indexOf('--port');
  const portArg = portIdx !== -1 ? args[portIdx + 1] : process.env.PORTPILOT_MCP_PORT;
  const port = portArg ? parseInt(portArg, 10) : null;

  if (port) {
    const hostIdx = args.indexOf('--host');
    const host = hostIdx !== -1 ? args[hostIdx + 1] : '127.0.0.1';
    await startHttp(port, host);
  } else {
    await createServer().connect(new StdioServerTransport());
    console.error('PortPilot MCP Server (stdio) running');
  }
}

// Only auto-start when run as the entry point (node index.js / fork), not when
// imported by a test. Pure helpers below are exported for unit testing.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(console.error);

export { findRuns, rerunSteps, alreadyRunning,normPath, appAtCwd, cmdSafe, startRefusal, observedDuplicate,pickColor, resolveWorktreeGit, registerWorktree, stampStart, detachedCommand, prepareLog };
