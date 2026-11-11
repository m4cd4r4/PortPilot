import type { AppRec, Host, Profile, Snapshot } from './host';

/**
 * The one rule every app and browser tile follows (Home, Apps, Browsers):
 *   running -> open it (the app's page, or bring the browser window forward)
 *   stopped -> start it, then open it
 *   blocked -> say why, with a link to Ports; never start, never open a form
 * Edit and Details are always a separate control, never the tile itself.
 */

/** What a blocked tile tells the user. `ports` adds the link to the Ports screen, filtered to `port` when it is known. */
export interface TileNotice { text: string; ports?: boolean; port?: number }

const proc = (name?: string) => (name || 'another process').replace(/\.exe$/i, '');

/**
 * Why an app cannot start, or null when nothing holds its port. Asked when Start is pressed:
 * this is the only place a taken port is reported, the card itself stays "stopped".
 */
export function appBlocked(snap: Snapshot, app: AppRec): TileNotice | null {
  const c = snap.conflicts.find((x) => x.appId === app.id);
  if (!c) return null;
  const pid = c.occupiedBy?.pid ? ` (pid ${c.occupiedBy.pid})` : '';
  return { text: `${app.name} cannot start: :${c.port} is held by ${proc(c.occupiedBy?.processName)}${pid}.`, ports: true, port: c.port };
}

/**
 * Start an app from a place with no notice line of its own (palette, Library, bell): a taken port is the error.
 * Asks the host at click time: the caller's snapshot can be a poll behind, and a port freed a
 * second ago must not be refused.
 */
export async function startApp(host: Host, app: AppRec): Promise<void> {
  const why = appBlocked(await host.snapshot(), app);
  if (why) throw new Error(why.text);
  await host.startApp(app);
}

/** Why a browser profile cannot start, or null when it can. */
export function profileBlocked(p: Profile): TileNotice | null {
  if (p.state !== 'blocked') return null;
  return { text: `${p.name} cannot start: ${p.warning || `:${p.port} is held by another process.`}`, ports: true, port: p.port };
}

const STEP_MS = 750;
const TRIES = 40;

/** Running: open its page. Stopped: start it, wait for a port, then open. Throws with a readable message on failure. */
export async function openApp(host: Host, app: AppRec, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  const url = (port: number) => `http://localhost:${port}`;
  // Ask the host, not the card: the card can be a poll behind.
  const now = (await host.snapshot()).running[app.id]?.port;
  if (now) { await host.openUrl(url(now)); return; }
  await host.startApp(app);
  for (let i = 0; i < TRIES; i++) {
    await wait(STEP_MS);
    const port = (await host.snapshot()).running[app.id]?.port;
    if (port) { await host.openUrl(url(port)); return; }
  }
  throw new Error(`${app.name} started but did not open a port within ${Math.round((STEP_MS * TRIES) / 1000)} seconds. Its Details show the output.`);
}

/** Running: bring the window forward. Stopped: start it (a started profile opens its window). */
export function openBrowser(host: Host, p: Profile): Promise<void> {
  return p.state === 'up' ? host.showBrowser(p.name) : host.startBrowser(p.name);
}
