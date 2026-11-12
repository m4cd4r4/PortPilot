import { useCallback, useEffect, useMemo, useState } from 'react';
import { every } from './poll';
import type { Host, Snapshot } from './host';
import { tally, type Alert, type View } from './model';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { usePrefs } from './prefs';
import { Home } from './components/Home';
import { Palette } from './components/Palette';
import { Localhost } from './components/Localhost';
import { History } from './components/History';
import { Browsers } from './components/Browsers';
import { Ports } from './components/Ports';
import { Scenes } from './components/Scenes';
import { Settings } from './components/Settings';
import { useThumbs } from './useThumbs';
import { syncTitleBar } from './titleBar';
import { CrashToasts } from './components/CrashToasts';
import { AppInspector } from './components/AppInspector';
import type { AlertAct } from './components/AlertsBell';
import { startApp } from './tileRule';

const EMPTY: Snapshot = { apps: [], groups: [], running: {}, crashed: {}, conflicts: [], profiles: [], ports: [] };

export function App({ host }: { host: Host }) {
  const [view, setViewRaw] = useState<View>('home');
  const [manage, setManage] = useState(false);
  /** A card clicked on Home: the Apps or Browsers screen opens straight onto that item. */
  const [focus, setFocus] = useState<{ kind: 'app' | 'browser'; id: string } | null>(null);
  /** 'library' is an alias for Apps in Manage mode; any other jump leaves Manage. */
  /** "Go to Ports" from a taken-port notice opens Ports filtered to that port. */
  const [portFilter, setPortFilter] = useState('');
  const setView = useCallback((v: View) => {
    setManage(v === 'library');
    setFocus(null);
    setPortFilter('');
    setViewRaw(v === 'library' ? 'localhost' : v);
  }, []);
  const toPorts = useCallback((port?: number) => { setView('ports'); setPortFilter(port ? String(port) : ''); }, [setView]);
  const openItem = useCallback((kind: 'app' | 'browser', id: string) => {
    setManage(false);
    setFocus({ kind, id });
    setViewRaw(kind === 'app' ? 'localhost' : 'browsers');
  }, []);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Logs opened from a crash toast, over whichever screen is showing. */
  const [logsFor, setLogsFor] = useState<string | null>(null);
  /** Why a bell action (Restart, Dismiss) failed; cleared by the next one. */
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      setSnap(await host.snapshot());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [host]);

  useEffect(() => {
    refresh();
    const stop = every(refresh, 5000);
    const off = host.onChange(refresh);
    return () => { stop(); off(); };
  }, [host, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const prefs = usePrefs();
  useEffect(() => {
    syncTitleBar();
    const mo = new MutationObserver(syncTitleBar);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('resize', syncTitleBar);
    mq.addEventListener('change', syncTitleBar);
    return () => { mo.disconnect(); window.removeEventListener('resize', syncTitleBar); mq.removeEventListener('change', syncTitleBar); };
  }, [prefs.nav]);
  const t = useMemo(() => tally(snap), [snap]);
  const thumbs = useThumbs(host);

  const restart = useCallback(async (appId: string) => {
    const app = snap.apps.find((a) => a.id === appId);
    if (!app) throw new Error('That app is no longer in PortPilot');
    try { await startApp(host, app); } finally { refresh(); }
  }, [host, snap.apps, refresh]);
  const onAlert = useCallback((a: Alert, act: AlertAct) => {
    setNotice('');
    const fail = (e: unknown) => setNotice((e as Error).message);
    if (a.appId && act === 'restart') restart(a.appId).catch(fail);
    else if (a.appId && act === 'dismiss') host.dismissCrash(a.appId).then(refresh, fail);
  }, [host, refresh, restart]);
  const logsApp = logsFor ? snap.apps.find((a) => a.id === logsFor) : undefined;

  return (
    <div className="shell" data-nav={prefs.nav}>
      <Sidebar view={view} onView={setView} onSearch={() => setPaletteOpen(true)} alerts={t.alerts} onAlert={onAlert} />
      <div className="col">
        <TopBar view={view} onView={setView} onSearch={() => setPaletteOpen(true)} alerts={t.alerts} onAlert={onAlert} />
        <div className="dragbar" aria-hidden="true" />
        <main className="main" id="main">
          {error && <p className="notice" role="alert">Could not read PortPilot state: {error}</p>}
          {notice && <p className="notice" role="alert">{notice}</p>}
          {view === 'home' && <Home host={host} onDone={refresh} t={t} loaded={loaded} onView={setView} onPorts={toPorts} onOpenItem={openItem} snap={snap} thumbs={thumbs} />}
          {view === 'localhost' && <Localhost host={host} snap={snap} thumbs={thumbs} onDone={refresh} manage={manage} onManage={setManage} inspectId={focus?.kind === 'app' ? focus.id : undefined} onPorts={toPorts} />}
          {view === 'history' && <History host={host} />}
          {view === 'scenes' && <Scenes host={host} snap={snap} onDone={refresh} />}
          {view === 'ports' && <Ports key={portFilter} host={host} snap={snap} onDone={refresh} filter={portFilter} />}
          {view === 'settings' && <Settings host={host} />}
          {view === 'browsers' && <Browsers host={host} snap={snap} onDone={refresh} editName={focus?.kind === 'browser' ? focus.id : undefined} onPorts={toPorts} />}
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} host={host} snap={snap}
        view={view} onView={setView} onDone={refresh} />
      <CrashToasts host={host} onRestart={restart} onLogs={setLogsFor} />
      {logsApp && <AppInspector host={host} app={logsApp} port={snap.running[logsApp.id]?.port} running={!!snap.running[logsApp.id]}
        crashed={!!snap.crashed[logsApp.id]} onClose={() => setLogsFor(null)} />}
    </div>
  );
}
