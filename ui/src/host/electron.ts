import type { AppRec, Host, Snapshot } from './types';

// window.portpilot is the contextBridge object from src/main/preload.js.
type Api = any;
const api = (): Api => (window as any).portpilot;

async function ok<T extends { success?: boolean; error?: string }>(p: Promise<T>): Promise<T> {
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
      const [cfg, proc, scan, br] = await Promise.all([
        api().config.getApps(), api().process.list(), api().ports.scanWithApps(), api().browsers.list(),
      ]);
      const running: Snapshot['running'] = {};
      for (const r of proc?.apps || []) if (r.running) running[r.id] = { port: r.port, pid: r.pid };
      // An app another tool started still shows as up: the scan matched it by port.
      for (const [id, m] of Object.entries<any>(scan?.matches || {})) running[id] ||= { port: m.port, pid: m.pid };
      return {
        apps: cfg?.apps || [],
        running,
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
    onChange(cb) { wire(); listeners.add(cb); return () => listeners.delete(cb); },
  };
}
