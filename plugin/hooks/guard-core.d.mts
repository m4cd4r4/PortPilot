// Types for guard-core.mjs, so register.tsx type-checks against it.

export type Listener = { port: number; pid: number | null; processName: string };
export type Listeners = Map<number, Listener>;
export type Platform = 'win32' | 'darwin' | 'linux';

export type App = { id: string; name: string; cwd?: string; preferredPort?: number | null; [k: string]: unknown };
export type Config = { apps?: App[]; [k: string]: unknown };
export type Runtime = { apps?: Record<string, { startedBy?: unknown; pid?: number | null; port?: number | null }> };

export type Start = { cd: string | null; port: number | null; script: string; raw: string; certain: boolean; bare: boolean };
export type AutoRegisterPlan = { name: string; command: string; cwd: string; port: number };
export type PackageJson = { name?: unknown; scripts?: Record<string, unknown>; [k: string]: unknown };
export type DevStart = { port: number | null; portKnown: boolean; env: boolean; script: string };
export type Decision =
  | { action: 'pass' }
  | { action: 'deny'; reason: string }
  | { action: 'route'; app: App; port: number | null; cd: string | null };
export type RouteResult =
  | { deny: string }
  | { result: { stdout: string; stderr: string; interrupted: boolean } };

export function parseListeners(platform: Platform, stdout: string): Listeners;
export function parseTasklistName(stdout: string): string | null;
export function appStates(config: Config | null, runtime: Runtime | null, listeners: Listeners, now?: number): Array<{ id: string; name: string; port: number; state: 'running' | 'starting' | 'crashed'; claude: boolean }>;
export function statusLine(config: Config | null, runtime: Runtime | null, listeners: Listeners, now?: number): string | undefined;
export function devStart(text: string): DevStart | null;
export function parseStart(command: string): Start | null;
export function normPath(p: string, opts?: { windows?: boolean; keepCase?: boolean }): string;
export function startDir(sessionCwd: string, cd: string | null, opts?: { windows?: boolean; home?: string; keepCase?: boolean }): string;
export function targetPort(c: { start: Start; dir: string; config: Config | null; windows?: boolean }): number | null;
export function holdersOf(port: number, holder: Listener | null | undefined, config: Config | null, runtime: Runtime | null): App[];
export function decide(c: { start: Start; dir: string; config: Config | null; runtime: Runtime | null; listeners: Listeners; windows?: boolean }): Decision;
export function autoRegisterPort(start: Start, pkg: PackageJson | null): number | null;
export function uniqueAppName(wanted: string, cwd: string, apps: App[]): string;
export function planAutoRegister(c: { start: Start; dir: string; cwd: string; config: Config | null; listeners: Listeners; pkg: PackageJson | null; home?: string; tools: { add: boolean; start: boolean }; windows?: boolean }): AutoRegisterPlan | null;
export function worktreeParent(c: { dir: string; gitDir: string | null; commonDir: string | null; config: Config | null; windows?: boolean }): App | null;
export function routeResult(route: { app: App; port: number | null; cd?: string | null; registered?: boolean }, ran: { deny?: string; isError?: boolean; text?: string }): RouteResult;
