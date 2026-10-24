import type { AppRec, Host, Scene, Snapshot } from './host';

/** What one Start did: each member lands in exactly one list. */
export interface SceneReport {
  started: string[];
  already: string[];
  failed: Array<{ name: string; reason: string }>;
}
/** What a scene itself started, so Stop never touches anything the user had running before. */
export interface SceneRun { apps: string[]; browsers: string[] }

const RUNS_KEY = 'portpilot-scene-runs';

function loadRuns(): Record<string, SceneRun> {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '{}') || {}; } catch { return {}; }
}
function saveRuns(runs: Record<string, SceneRun>) {
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs)); } catch { /* storage can be unavailable */ }
}
export const sceneRun = (id: string): SceneRun | null => loadRuns()[id] || null;

/** The apps and browser profiles that are up right now: the starting point of "save what is running". */
export function captureRunning(snap: Snapshot): { apps: string[]; browsers: string[] } {
  return {
    apps: snap.apps.filter((a) => !a.parentId && snap.running[a.id]).map((a) => a.id),
    browsers: snap.profiles.filter((p) => p.state === 'up').map((p) => p.name),
  };
}

export const sceneSummary = (s: Scene) => {
  const bits = [s.apps.length ? `${s.apps.length} ${s.apps.length === 1 ? 'app' : 'apps'}` : '', s.browsers.length ? `${s.browsers.length} ${s.browsers.length === 1 ? 'browser' : 'browsers'}` : ''];
  return bits.filter(Boolean).join(', ');
};

/** Start every member one by one. A blocked port or a missing profile is reported, never fatal. */
export async function startScene(host: Host, scene: Scene): Promise<SceneReport> {
  // The caller's snapshot polls every 5s; decide from the real state at click time.
  const snap = await host.snapshot();
  const report: SceneReport = { started: [], already: [], failed: [] };
  const run: SceneRun = { apps: [], browsers: [] };
  for (const id of scene.apps) {
    const app: AppRec | undefined = snap.apps.find((a) => a.id === id);
    if (!app) { report.failed.push({ name: id, reason: 'no longer in the Library' }); continue; }
    if (snap.running[id]) { report.already.push(app.name); continue; }
    const held = snap.conflicts.find((c) => c.appId === id);
    if (held) {
      report.failed.push({ name: app.name, reason: `:${held.port} is held by ${(held.occupiedBy?.processName || 'another process').replace(/\.exe$/i, '')}` });
      continue;
    }
    try { await host.startApp(app); report.started.push(app.name); run.apps.push(id); }
    catch (e) { report.failed.push({ name: app.name, reason: (e as Error).message }); }
  }
  for (const name of scene.browsers) {
    const profile = snap.profiles.find((p) => p.name === name);
    if (!profile) { report.failed.push({ name, reason: 'profile was removed' }); continue; }
    if (profile.state === 'up') { report.already.push(name); continue; }
    try { await host.startBrowser(name); report.started.push(name); run.browsers.push(name); }
    catch (e) { report.failed.push({ name, reason: (e as Error).message }); }
  }
  const runs = loadRuns();
  runs[scene.id] = run;
  saveRuns(runs);
  return report;
}

/** Stop only what this scene started and that is still up. Returns the names stopped. */
export async function stopScene(host: Host, scene: Scene): Promise<string[]> {
  const snap = await host.snapshot();
  const run = sceneRun(scene.id);
  const stopped: string[] = [];
  if (run) {
    for (const id of run.apps) {
      if (!snap.running[id]) continue;
      await host.stopApp(id);
      stopped.push(snap.apps.find((a) => a.id === id)?.name || id);
    }
    for (const name of run.browsers) {
      if (snap.profiles.find((p) => p.name === name)?.state !== 'up') continue;
      await host.stopBrowser(name);
      stopped.push(name);
    }
  }
  const runs = loadRuns();
  delete runs[scene.id];
  saveRuns(runs);
  return stopped;
}
