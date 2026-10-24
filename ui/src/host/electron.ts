import type { AppRec, Host, Snapshot } from './types';

// window.portpilot is the contextBridge object from src/main/preload.js.
type Api = any;
const api = (): Api => (window as any).portpilot;

async function ok(p: Promise<any>): Promise<any> {
  const r = await p;
  if (r && r.success === false) throw new Error(r.error || 'Request failed');
  return r;
}

export function createElectronHost(): Host {
  const listeners = new Set<() => void>();
  let wired = false;
  const wire = () => {
    if (wired) return;
    wired = true;
    // preload.on has no unsubscribe, so register once and fan out here.
    for (const ch of ['config-changed', 'trigger-scan']) api().on(ch, () => listeners.forEach((l) => l()));
  };

  return {
    kind: 'electron',
    async snapshot(): Promise<Snapshot> {
      const [cfg, groups, proc, scan, br] = await Promise.all([
        api().config.getApps(), api().config.getGroups(), api().process.list(), api().ports.scanWithApps(), api().browsers.list(),
      ]);
      const running: Snapshot['running'] = {};
      const crashed: Snapshot['crashed'] = {};
      for (const r of proc?.apps || []) {
        if (r.running) running[r.id] = { pid: r.pid };
        else if (r.crashed) crashed[r.id] = { exitCode: r.exitCode };
      }
      // The scan knows the port an app is really on, and also finds apps another tool started.
      for (const [id, m] of Object.entries<any>(scan?.matches || {})) running[id] = { ...running[id], port: m.port, pid: running[id]?.pid ?? m.pid };
      for (const id of Object.keys(running)) delete crashed[id];
      return {
        apps: cfg?.apps || [],
        groups: groups?.groups || [],
        running,
        crashed,
        conflicts: scan?.unknownConflicts || [],
        ports: scan?.ports || [],
        profiles: br?.profiles || [],
      };
    },
    async startApp(app: AppRec) { await ok(api().process.start(app)); },
    async stopApp(id) { await ok(api().process.stop(id)); },
    async openUrl(url) { await api().openExternal(url); },
    async startBrowser(name) { await ok(api().browsers.start(name)); },
    async stopBrowser(name) { await ok(api().browsers.stop(name)); },
    async killPort(port) { await ok(api().ports.kill(port)); },
    async switchToClassic() { await ok(api().ui.switch('classic')); },
    async releaseBrowser(name) { await ok(api().browsers.release(name)); },
    async saveBrowser(original, fields) { await ok(api().browsers.save(original, fields)); },
    async removeBrowser(name) { await ok(api().browsers.remove(name)); },
    async browserArtIndex() { return (await ok(api().browsers.artIndex())).byName || {}; },
    async browserArt(names) { return (await ok(api().browsers.artGet(names))).arts || {}; },
    async refreshBrowserArt(name, force) { return !!(await ok(api().browsers.artRefresh(name, force))).found; },
    async chooseBrowserArt(name) { return !(await ok(api().browsers.artChoose(name))).cancelled; },
    async clearBrowserArt(name) { await ok(api().browsers.artClear(name)); },
    async browserSignIns(names) { return (await ok(api().browsers.signIns(names))).health || {}; },
    async thumbIndex() { return (await ok(api().thumbs.index())).byApp || {}; },
    async thumbs(keys) { return (await ok(api().thumbs.get(keys))).thumbs || {}; },
    async captureThumb(appId, port) {
      const r = await api().thumbs.capture(appId, port);
      return r?.success ? { ok: true, key: r.key } : { ok: false, reason: r?.reason || 'failed' };
    },
    async history() {
      const r = await ok(api().history.list());
      return { runs: r.runs || [], live: r.live || [], startable: r.startable || [] };
    },
    async startAgain(runId) { return (await ok(api().history.startAgain(runId))).url || null; },
    onChange(cb) { wire(); listeners.add(cb); return () => listeners.delete(cb); },
  };
}
