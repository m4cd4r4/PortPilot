import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RowThumbRef } from './treeModel';

export interface PortPilotApp {
  id: string;
  name: string;
  command: string;
  cwd: string;
  preferredPort: number | null;
  fallbackRange: { start: number; end: number } | null;
  env: Record<string, string>;
  autoStart: boolean;
  isFavorite: boolean;
  color: string;
  description?: string;
  group?: string | null;
  // Worktree / branch awareness (Wave 3). Optional; absent on plain apps.
  parentId?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  colorSource?: 'peacock' | 'manual' | 'auto' | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortPilotGroup {
  id: string;
  name: string;
  expanded: boolean;
  color?: string;
}

export interface PortPilotConfig {
  apps: PortPilotApp[];
  settings: Record<string, unknown>;
  groups: PortPilotGroup[];
}

export function getConfigPath(): string {
  const platform = os.platform();
  let configDir: string;

  // NOTE: must match Electron's app.getPath('userData'), which is derived from
  // the lowercase package.json "name" ("portpilot"). Using "PortPilot" (capital)
  // works on case-insensitive Windows but reads a DIFFERENT file on Linux/macOS,
  // so the extension would never see the desktop app's config.
  if (platform === 'win32') {
    configDir = path.join(process.env.APPDATA || '', 'portpilot');
  } else if (platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'portpilot');
  } else {
    configDir = path.join(os.homedir(), '.config', 'portpilot');
  }

  return path.join(configDir, 'portpilot-config.json');
}

export function readConfig(): PortPilotConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('PortPilot: Error reading config:', error);
  }
  return { apps: [], settings: {}, groups: [] };
}

// Lock + atomic-write helpers and the status/provenance model, shared with the
// desktop app, agent and MCP server. scripts/copy-runtime.js copies
// src/core/{configFile,status}.js into runtime/ at build.
export interface StartedBy {
  kind: 'human' | 'claude' | 'external';
  surface: 'desktop' | 'web' | 'vscode' | 'claude-code' | 'mcp';
  sessionId?: string;
  label?: string;
  at: string;
}
interface ConfigFileApi {
  updateJson<T>(file: string, mutator: (config: PortPilotConfig) => T, fallback: () => PortPilotConfig): { config: PortPilotConfig; result: T };
  recordStart(configPath: string, appId: string, startedBy: StartedBy, opts?: { pid?: number | null; port?: number | null }): boolean;
  recordStop(configPath: string, appId: string): boolean;
  readRuntime(configPath: string): { apps: Record<string, RuntimeEntry> };
  logPathFor(configPath: string, appId: string): string;
}
export interface RuntimeEntry {
  startedBy?: StartedBy;
  pid?: number | null;
  port?: number | null;
  crashed?: {
    exitCode: number | null;
    at: number;
    startedBy?: StartedBy | null;
    port?: number | null;
    errorTail?: string | null;
  };
}
export interface RowState {
  state: 'running' | 'starting' | 'error' | 'conflict' | 'crashed' | 'stopped';
  word: string;
  reason: string;
  uptime: string;
  provenance: string;
  text: string;
  title: string;
}
interface StatusApi {
  makeStartedBy(fields: Partial<StartedBy>): StartedBy;
  rowStateOf(rec: {
    running?: boolean; crashed?: boolean; exitCode?: number | null;
    uptimeSec?: number | null; startedBy?: StartedBy | null;
  }): RowState;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const configFile: ConfigFileApi = require(path.join(__dirname, '..', 'runtime', 'core', 'configFile.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const status: StatusApi = require(path.join(__dirname, '..', 'runtime', 'core', 'status.js'));

// Run history: the same history/runs.json and history/thumbs the desktop writes.
interface RunHistoryApi {
  readRuns(configPath: string): unknown[];
  historyDirFor(configPath: string): string;
  pinRun(configPath: string, runId: string, pinned: boolean): { ok: boolean; reason?: string };
}
interface RunViewApi {
  rowThumbs(runs: unknown[]): Record<string, RowThumbRef>;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const runHistory: RunHistoryApi = require(path.join(__dirname, '..', 'runtime', 'core', 'runHistory.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const runView: RunViewApi = require(path.join(__dirname, '..', 'runtime', 'core', 'runView.js'));

// Browser profiles: the same `browserProfiles` list and the same start/stop API the MCP tools use.
interface BrowserProfilesApi { listProfiles(configPath: string): unknown[]; }
export interface BrowserResult {
  success: boolean;
  code?: string;
  error?: string;
  action?: string;
  note?: string;
  already?: boolean;
  port?: number;
  name?: string;
  mode?: string;
  profiles?: unknown[];
  [k: string]: unknown;
}
interface BrowserApi {
  call(configPath: string, tool: string, args: Record<string, unknown>, ctx: { surface: string }): Promise<BrowserResult>;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const browserProfiles: BrowserProfilesApi = require(path.join(__dirname, '..', 'runtime', 'core', 'browserProfiles.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const browserApi: BrowserApi = require(path.join(__dirname, '..', 'runtime', 'core', 'browserApi.js'));

let profilesCache: { key: string; profiles: unknown[] } | null = null;

/** The raw `browserProfiles` list, re-read only when the config file's mtime or size moves. Empty on any read failure. */
export function readBrowserProfilesCached(): { key: string; profiles: unknown[] } {
  try {
    const configPath = getConfigPath();
    const st = fs.statSync(configPath);
    const key = `${configPath}|${st.mtimeMs}|${st.size}`;
    if (profilesCache?.key !== key) profilesCache = { key, profiles: browserProfiles.listProfiles(configPath) };
    return profilesCache;
  } catch { return { key: 'none', profiles: [] }; }
}

/** One browser tool (list_browser_profiles, start_browser, stop_browser, set_browser_mode). Resolves always; a throw becomes a failure result. */
export async function browserCall(tool: string, args: Record<string, unknown> = {}): Promise<BrowserResult> {
  try {
    return await browserApi.call(getConfigPath(), tool, { agent: 'VS Code', ...args }, { surface: 'vscode' });
  } catch (err) {
    return { success: false, code: 'INTERNAL', error: (err as Error).message || 'The browser tool failed.', action: 'Try again, or report this.' };
  }
}

/** Record that the user started an app from VS Code (best-effort, never throws). */
export function recordHumanStart(app: PortPilotApp): boolean {
  return configFile.recordStart(getConfigPath(), app.id,
    status.makeStartedBy({ kind: 'human', surface: 'vscode' }), { port: app.preferredPort });
}

/** Clear an app's provenance after it stops (best-effort, never throws). */
export function recordAppStop(appId: string): boolean {
  return configFile.recordStop(getConfigPath(), appId);
}

/** Per-app runtime entries (provenance, crash stamp). Empty on any read failure. */
export function readRuntimeApps(): Record<string, RuntimeEntry> {
  try { return configFile.readRuntime(getConfigPath()).apps; } catch { return {}; }
}

// runs.json is the biggest file the 10s refresh touches: re-parse it only when it changes.
let runsCache: { key: string; runs: unknown[] } | null = null;
let thumbCache: { key: string; thumbs: Record<string, RowThumbRef> } | null = null;

/** The parsed runs plus a key that changes whenever the file does. Empty on any read failure. */
export function readRunsCached(): { key: string; runs: unknown[] } {
  try {
    const configPath = getConfigPath();
    const runsFile = path.join(runHistory.historyDirFor(configPath), 'runs.json');
    const st = fs.statSync(runsFile);
    const key = `${runsFile}|${st.mtimeMs}|${st.size}`;
    if (runsCache?.key !== key) runsCache = { key, runs: runHistory.readRuns(configPath) };
    return runsCache;
  } catch { return { key: 'none', runs: [] }; }
}

/** Newest open run with a page thumbnail, per app. Empty on any read failure. */
export function readRowThumbs(): Record<string, RowThumbRef> {
  try {
    const { key, runs } = readRunsCached();
    if (thumbCache?.key !== key) thumbCache = { key, thumbs: runView.rowThumbs(runs) };
    return thumbCache.thumbs;
  } catch { return {}; }
}

/** Pin or unpin a run in the shared history (a 51st pin is refused). Never throws. */
export function pinHistoryRun(runId: string, pinned: boolean): { ok: boolean; reason?: string } {
  try { return runHistory.pinRun(getConfigPath(), runId, pinned); } catch { return { ok: false, reason: 'error' }; }
}

/**
 * Find or register the app a history run belongs to, so it can be started again.
 * runApp.js ships with the desktop's localhost detection; until it is bundled
 * (missing module) a registered run falls back to its own app, a detected one fails.
 */
export function appForRun(run: { appId?: string | null }): { ok: true; appId: string; port: number | null } | { ok: false; error: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runApp: { appForRun(configPath: string, run: unknown): { ok: boolean; appId?: string; port?: number | null; error?: string } } =
      require(path.join(__dirname, '..', 'runtime', 'core', 'runApp.js'));
    const res = runApp.appForRun(getConfigPath(), run);
    return res.ok && res.appId ? { ok: true, appId: res.appId, port: res.port ?? null } : { ok: false, error: res.error || 'unknown' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') return { ok: false, error: (err as Error).message };
    const app = readConfig().apps.find(a => a.id === run.appId);
    return app ? { ok: true, appId: app.id, port: app.preferredPort } : { ok: false, error: 'This PortPilot build cannot start a detected server again yet.' };
  }
}

const THUMB_MAX_BYTES = 512 * 1024;

/** A run's thumbnail as a data URI (thumbnails never leave this machine), or null. */
export function thumbDataUri(thumb: string): string | null {
  try {
    const dir = path.resolve(runHistory.historyDirFor(getConfigPath()));
    const file = path.resolve(dir, thumb);
    // A thumb path read from runs.json must stay under history/.
    if (!file.startsWith(dir + path.sep)) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > THUMB_MAX_BYTES) return null;
    return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch { return null; }
}

/** Where a detached app's output is written (logs/<appId>.log beside the config). */
export function logPathFor(appId: string): string {
  return configFile.logPathFor(getConfigPath(), appId);
}

export const rowStateOf = (rec: Parameters<StatusApi['rowStateOf']>[0]): RowState => status.rowStateOf(rec);

/**
 * Locked read-modify-write against the file on disk. Do any user prompting
 * BEFORE calling this: the mutator must be synchronous, and a config object
 * held across a prompt would overwrite whatever other processes wrote meanwhile.
 */
export function updateConfig<T>(mutator: (config: PortPilotConfig) => T): T {
  return configFile.updateJson(getConfigPath(), (config) => {
    if (!config.apps) config.apps = [];
    return mutator(config);
  }, () => ({ apps: [], settings: {}, groups: [] })).result;
}

export function generateId(): string {
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
