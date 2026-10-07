import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
