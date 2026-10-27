export interface AppRec {
  id: string; name: string; preferredPort?: number; branch?: string; parentId?: string; groupId?: string; command?: string;
  cwd?: string; group?: string | null; description?: string | null; autoStart?: boolean; isFavorite?: boolean; reservePort?: boolean; healthPath?: string | null;
  createdAt?: string;
}
/** What the add/edit form sends to config:saveApp; the host merges it onto the stored record. */
export interface AppFields {
  id?: string; name: string; command: string; cwd?: string; preferredPort?: number | null; group?: string | null;
  description?: string | null; autoStart?: boolean; healthPath?: string | null; reservePort?: boolean;
}
/** The keys of config.settings the Settings screen edits (src/main/configStore.js defaultConfig). */
export interface Settings {
  autoScan?: boolean; scanInterval?: number; closeToTray?: boolean; stopAppsOnQuit?: boolean; openAtLogin?: boolean;
  autoResizeWindow?: boolean; notifyOnCrash?: boolean; autoTrackLocalhost?: boolean; autoRegister?: boolean; openDevTools?: boolean;
  historySnapshots?: boolean; historyMaxRuns?: number; historyMaxMB?: number; rowPreviews?: boolean;
  discovery?: { scanPaths?: string[]; maxDepth?: number; autoScanOnStartup?: boolean };
}
export interface ShareInfo { localUrl: string; lanUrl: string | null; qrDataUrl: string | null }
export interface DiagnoseStatus { cli: boolean; consent: boolean; running: boolean }
export interface DiagnoseEvent { appId: string; kind: 'tool' | 'text' | 'error' | 'done' | 'end'; label?: string; text?: string }
export interface PortRow { port: number; pid?: number; processName?: string }
export interface Detected { name?: string; command?: string; cwd?: string; port?: number; preferredPort?: number }
export interface Conflict { appId?: string; appName?: string; port: number; occupiedBy?: { processName?: string; pid?: number } }
export interface Account { platform?: string; username?: string; note?: string }
export interface Lease { by: string; session?: string; since?: string; starting?: boolean }
export type SignIn = 'in' | 'out' | 'unknown';
/** One browser profile as browser:list returns it (src/core/browserApi.js list_browser_profiles rows). */
export interface Profile {
  name: string; state?: string; port?: number; url?: string; note?: string;
  mode?: string; browser?: string; purpose?: string; sites?: string[]; accounts?: Account[];
  leasedTo?: Lease | null; free?: boolean; lastUsed?: string; tabs?: Array<{ title?: string; url?: string }>; warning?: string;
}
/** The fields the edit drawer sends to browser:save. */
export interface ProfileFields {
  name?: string; port?: number | string; browser?: string; mode?: string; url?: string; note?: string; purpose?: string;
  sites?: string[]; accounts?: Account[];
}
export interface ArtRef { source: string; at: number }
export interface Group { id: string; name: string }
/** A saved set of apps (ids) and browser profiles (names) started together. */
export interface Scene { id: string; name: string; apps: string[]; browsers: string[] }
export type SceneFields = Omit<Scene, 'id'> & { id?: string };

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
  ports: PortRow[];
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
  /** End a lease; the browser keeps running. */
  releaseBrowser(name: string): Promise<void>;
  /** Add (original null) or edit a profile. Rejects with the host's plain-English reason. */
  saveBrowser(original: string | null, fields: ProfileFields): Promise<void>;
  removeBrowser(name: string): Promise<void>;
  /** Cheap index of profiles that have a picture, then the pixels by name. */
  browserArtIndex(): Promise<Record<string, ArtRef>>;
  browserArt(names: string[]): Promise<Record<string, string>>;
  /** Fetch the site's own picture; true when the profile now has one. */
  refreshBrowserArt(name: string, force?: boolean): Promise<boolean>;
  /** Let the user pick an image file; false when they cancel. */
  chooseBrowserArt(name: string): Promise<boolean>;
  clearBrowserArt(name: string): Promise<void>;
  /** Sign-in state of running profiles; stopped ones are 'unknown'. */
  browserSignIns(names: string[]): Promise<Record<string, SignIn>>;
  /** Open Brave's Sync or password-import page in a running profile; the person signs in there. */
  openSignInSetup(name: string, which: 'sync' | 'passwords'): Promise<void>;
  killPort(port: number): Promise<void>;
  /** Reload the window as the classic v4 UI; it comes back on the next launch too. */
  switchToClassic(): Promise<void>;
  thumbIndex(): Promise<Record<string, ThumbRef>>;
  thumbs(keys: string[]): Promise<Record<string, string>>;
  /** Ask for a fresh screenshot; the host throttles (one per app per 10 s, one in flight). */
  captureThumb(appId: string, port: number): Promise<CaptureResult>;
  history(): Promise<HistoryData>;
  /** Restart a closed run; resolves to the URL once it answers (or null). */
  startAgain(runId: string): Promise<string | null>;
  /** Saved settings (partial merge on write). */
  getSettings(): Promise<Settings>;
  updateSettings(patch: Settings): Promise<Settings>;
  /** Add (no id) or update an app; resolves to the stored record. */
  saveApp(fields: AppFields): Promise<AppRec>;
  deleteApp(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  saveGroup(group: { id?: string; name: string }): Promise<Group>;
  deleteGroup(id: string): Promise<void>;
  /** Folder picker; null when the user cancels. */
  browseDirectory(): Promise<string | null>;
  /** Read a project's command and port from its folder; null when nothing is found. */
  detectProject(dir: string): Promise<Detected | null>;
  findFreePort(start?: number, end?: number): Promise<number>;
  /** Output of an app PortPilot started; empty when it is not running. */
  appLogs(id: string): Promise<{ stdout: string; stderr: string }>;
  shareInfo(port: number): Promise<ShareInfo>;
  diagnoseStatus(id: string): Promise<DiagnoseStatus>;
  diagnoseConsent(): Promise<void>;
  diagnoseStart(id: string): Promise<void>;
  diagnoseCancel(id: string): Promise<void>;
  onDiagnose(cb: (e: DiagnoseEvent) => void): () => void;
  scenes(): Promise<Scene[]>;
  saveScene(fields: SceneFields): Promise<Scene>;
  deleteScene(id: string): Promise<void>;
  /** Subscribe to "something changed, re-read the snapshot"; returns an unsubscribe. */
  onChange(cb: () => void): () => void;
}
