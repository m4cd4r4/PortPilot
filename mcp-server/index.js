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

// =============================================================================
// CONFIG
// =============================================================================

function getConfigPath() {
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

function readConfig() {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { apps: [], settings: {}, groups: [] };
  }
}

function writeConfig(config) {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
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
 * Start an app and report an HONEST result. When the app has a preferredPort we
 * poll for it to come up (so a command that fails immediately reports failure
 * instead of a misleading success). Without a port we can only confirm the
 * shell spawned, and say so.
 */
function startApp(app) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; resolve(res); } };
    try {
      const env = { ...process.env, ...app.env };
      if (app.preferredPort) env.PORT = String(app.preferredPort);

      const options = { cwd: app.cwd, env, detached: true, stdio: 'ignore', shell: true, windowsHide: true };
      const child = os.platform() === 'win32'
        ? exec(`start /B cmd /c "${app.command}"`, options)
        : exec(`nohup ${app.command} >/dev/null 2>&1 &`, options);

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
// MCP SERVER
// =============================================================================

function createServer() {
  const server = new McpServer({
    name: 'portpilot',
    version: '3.3.0',
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
    { identifier: z.string().describe('App ID or name') },
    async ({ identifier }) => {
      const config = readConfig();
      const app = findApp(config.apps || [], identifier);
      if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
      const result = await startApp(app);
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
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.success };
    }
  );

  // --- Bulk Start ---

  server.tool(
    'bulk_start',
    'Start multiple apps at once by group name, or all favorites',
    {
      group: z.string().optional().describe('Start all apps in this group'),
      favorites: z.boolean().optional().describe('Start all favorite apps')
    },
    async ({ group, favorites }) => {
      const config = readConfig();
      let apps = config.apps || [];

      if (group) apps = apps.filter(a => a.group === group);
      else if (favorites) apps = apps.filter(a => a.isFavorite);
      else return { content: [{ type: 'text', text: 'Specify group or favorites: true' }], isError: true };

      const results = await Promise.all(apps.map(async a => ({ name: a.name, ...(await startApp(a)) })));
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
      const results = running.map(a => ({ name: a.name, ...stopApp(a) }));
      return { content: [{ type: 'text', text: JSON.stringify({ stopped: results.length, results }, null, 2) }] };
    }
  );

  // --- Add App ---

  server.tool(
    'add_app',
    'Register a new app in PortPilot',
    {
      name: z.string().describe('App display name'),
      command: z.string().describe('Shell command to start (e.g. "npm run dev")'),
      cwd: z.string().describe('Working directory path'),
      preferredPort: z.number().optional().describe('Preferred port number'),
      isFavorite: z.boolean().optional().describe('Mark as favorite'),
      autoStart: z.boolean().optional().describe('Auto-start on launch'),
      group: z.string().optional().describe('Group name to assign to'),
      description: z.string().optional().describe('Short description')
    },
    async ({ name, command, cwd, preferredPort, isFavorite, autoStart, group, description }) => {
      const config = readConfig();
      if (!config.apps) config.apps = [];

      if (config.apps.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        return { content: [{ type: 'text', text: `App "${name}" already exists` }], isError: true };
      }

      const now = new Date().toISOString();
      const newApp = {
        id: generateId(), name, command, cwd,
        preferredPort: preferredPort || null,
        fallbackRange: null, env: {},
        autoStart: autoStart || false,
        isFavorite: isFavorite || false,
        group: group || null,
        description: description || null,
        color: '#4fc3f7',
        createdAt: now, updatedAt: now
      };

      config.apps.push(newApp);
      writeConfig(config);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Added "${name}"`, app: newApp }, null, 2) }] };
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
      const config = readConfig();
      const git = resolveWorktreeGit(wtPath);
      const result = registerWorktree(config, { path: wtPath, command, preferredPort, branch, parent, name }, git, new Date().toISOString());
      if (!result.ok) {
        return { content: [{ type: 'text', text: result.error }], isError: true };
      }
      writeConfig(config);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
      description: z.string().optional()
    },
    async ({ identifier, ...updates }) => {
      const config = readConfig();
      const idx = (config.apps || []).findIndex(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
      if (idx === -1) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };

      // Remove undefined values
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      config.apps[idx] = { ...config.apps[idx], ...clean, updatedAt: new Date().toISOString() };
      writeConfig(config);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, app: config.apps[idx] }, null, 2) }] };
    }
  );

  // --- Delete App ---

  server.tool(
    'delete_app',
    'Remove an app from PortPilot',
    { identifier: z.string().describe('App ID or name to delete') },
    async ({ identifier }) => {
      const config = readConfig();
      const idx = (config.apps || []).findIndex(a => a.id === identifier || a.name.toLowerCase() === identifier.toLowerCase());
      if (idx === -1) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
      const deleted = config.apps.splice(idx, 1)[0];
      writeConfig(config);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: deleted.name }, null, 2) }] };
    }
  );

  // --- Delete All Apps ---

  server.tool(
    'delete_all_apps',
    'Delete ALL apps from PortPilot. Requires confirm: true.',
    { confirm: z.boolean().describe('Must be true to confirm') },
    async ({ confirm }) => {
      if (!confirm) return { content: [{ type: 'text', text: 'Pass confirm: true to delete all apps' }], isError: true };
      const config = readConfig();
      const count = (config.apps || []).length;
      const names = (config.apps || []).map(a => a.name);
      config.apps = [];
      writeConfig(config);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: count, names }, null, 2) }] };
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
      const config = readConfig();
      const app = findApp(config.apps || [], identifier);
      if (!app) return { content: [{ type: 'text', text: `App not found: ${identifier}` }], isError: true };
      app.isFavorite = !app.isFavorite;
      app.updatedAt = new Date().toISOString();
      writeConfig(config);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, name: app.name, isFavorite: app.isFavorite }, null, 2) }] };
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
      const config = readConfig();
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
      writeConfig(config);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, name: app.name, group: app.group }, null, 2) }] };
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

  const httpServer = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url !== '/mcp') {
      res.writeHead(404).end('Not found');
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
  const config = readConfig();
  const git = resolveWorktreeGit(f.path);
  const result = registerWorktree(config, {
    path: f.path,
    branch: f.branch,
    parent: f.parent,
    name: f.name,
    command: f.command,
    preferredPort: f.port ? parseInt(f.port, 10) : undefined,
    color: f.color,
    colorSource: f.color ? 'peacock' : undefined,
  }, git, new Date().toISOString());
  if (!result.ok) { console.error(result.error); process.exit(1); }
  writeConfig(config);
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

export { normPath, pickColor, resolveWorktreeGit, registerWorktree };
