export interface PortRow { port: number; processName?: string; pid?: number }

/**
 * What counts as an operating-system process or port is decided in one place, src/core/status.js,
 * which the VS Code extension and the web portal use too. It is a UMD script that sets this global
 * (ui/src/legacy.ts loads it), not an ES module.
 */
type Classify = (p: PortRow) => 'dev' | 'other' | 'system';
const core = (): Classify => {
  const api = (globalThis as unknown as { PortPilotStatus?: { classify: Classify } }).PortPilotStatus;
  if (!api) throw new Error('src/core/status.js is not loaded');
  return api.classify;
};

/**
 * A port no dev server owns: under 1024, or one the shared model calls system (an OS process such
 * as svchost, or a well-known service port). A port one of the user's own apps is running on is
 * never a system port, whatever its number.
 */
export function isSystemPort(p: PortRow, owned: Set<number> = new Set()): boolean {
  if (owned.has(p.port)) return false;
  if (p.port < 1024) return true;
  const classify = core();
  // The shared list names Windows processes with ".exe"; a scan can report them without it.
  const name = p.processName || '';
  return classify(p) === 'system' || (!!name && !/\.exe$/i.test(name) && classify({ ...p, processName: `${name}.exe` }) === 'system');
}

/** Where the range starts that an operating system hands out to programs asking for "any free port". */
const DYNAMIC_FROM = 49152;

/**
 * A port a program opened for its own use (an editor, a browser, a helper): 49152 or above, not a
 * system port, and not one a PortPilot app is running on. On a busy machine these are most of the list.
 */
export function isTempPort(p: PortRow, owned: Set<number> = new Set()): boolean {
  return p.port >= DYNAMIC_FROM && !owned.has(p.port) && !isSystemPort(p, owned);
}

/** The Ports list in three parts, each in port order: the user's side first, then temporary, then system. */
export function splitPorts<T extends PortRow>(ports: T[], owned: Set<number> = new Set()): { mine: T[]; temp: T[]; system: T[] } {
  const sorted = [...ports].sort((a, b) => a.port - b.port);
  const system = sorted.filter((p) => isSystemPort(p, owned));
  const temp = sorted.filter((p) => isTempPort(p, owned));
  return { mine: sorted.filter((p) => !isSystemPort(p, owned) && !isTempPort(p, owned)), temp, system };
}
