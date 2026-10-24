export interface AppRec { id: string; name: string; preferredPort?: number; branch?: string; parentId?: string; command?: string }
export interface Conflict { appId?: string; appName?: string; port: number; occupiedBy?: { processName?: string; pid?: number } }
export interface Profile { name: string; state?: string; port?: number; url?: string; note?: string }
export interface Snapshot {
  apps: AppRec[];
  /** appId -> live info, present only while the app is up */
  running: Record<string, { port?: number; pid?: number }>;
  conflicts: Conflict[];
  profiles: Profile[];
  /** listeners on the machine, for the palette's "free port" commands */
  ports: Array<{ port: number; pid?: number; processName?: string }>;
}

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
  /** Subscribe to "something changed, re-read the snapshot"; returns an unsubscribe. */
  onChange(cb: () => void): () => void;
}
