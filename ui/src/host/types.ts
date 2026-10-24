export interface AppRec { id: string; name: string; preferredPort?: number; branch?: string; parentId?: string; groupId?: string; command?: string }
export interface Conflict { appId?: string; appName?: string; port: number; occupiedBy?: { processName?: string; pid?: number } }
export interface Profile { name: string; state?: string; port?: number; url?: string; note?: string }
export interface Group { id: string; name: string }

export interface Snapshot {
  apps: AppRec[];
  groups: Group[];
  /** appId -> live info, present only while the app is up */
  running: Record<string, { port?: number; pid?: number }>;
  /** appId -> exit info for an app PortPilot started that has since died */
  crashed: Record<string, { exitCode?: number }>;
  conflicts: Conflict[];
  profiles: Profile[];
  /** listeners on the machine, for the palette's "free port" commands */
  ports: Array<{ port: number; pid?: number; processName?: string }>;
}

/** One entry of the cheap thumbnail index: the key names the pixels, `live` says it is a fresh capture. */
export interface ThumbRef { key: string; at: number; live: boolean }
export type CaptureResult = { ok: true; key: string } | { ok: false; reason: string };

/** A run from history, as stored (src/core/runHistory.js). Only the fields the UI reads are typed. */
export interface Run {
  id: string; appId?: string; appName?: string; port?: number; startedAt: string; stoppedAt?: string | null;
  endedBy?: string; exitCode?: number; detected?: boolean; cwd?: string; command?: string;
  git?: { branch?: string; sha?: string; subject?: string } | null;
  page?: { title?: string; thumb?: string } | null;
  startedBy?: unknown;
}
export interface HistoryData { runs: Run[]; live: string[]; startable: string[] }

/** What the UI needs from whoever hosts it: Electron IPC today, HTTP (web portal) and VS Code postMessage later. */
export interface Host {
  kind: 'electron' | 'http' | 'vscode';
  snapshot(): Promise<Snapshot>;
  startApp(app: AppRec): Promise<void>;
  stopApp(id: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  startBrowser(name: string): Promise<void>;
  stopBrowser(name: string): Promise<void>;
  killPort(port: number): Promise<void>;
  thumbIndex(): Promise<Record<string, ThumbRef>>;
  thumbs(keys: string[]): Promise<Record<string, string>>;
  /** Ask for a fresh screenshot; the host throttles (one per app per 10 s, one in flight). */
  captureThumb(appId: string, port: number): Promise<CaptureResult>;
  history(): Promise<HistoryData>;
  /** Restart a closed run; resolves to the URL once it answers (or null). */
  startAgain(runId: string): Promise<string | null>;
  /** Subscribe to "something changed, re-read the snapshot"; returns an unsubscribe. */
  onChange(cb: () => void): () => void;
}
