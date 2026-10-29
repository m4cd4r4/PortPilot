import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Host, Snapshot } from './host';
import { tally, type View } from './model';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { usePrefs } from './prefs';
import { Home } from './components/Home';
import { Banner } from './components/Banner';
import { Palette } from './components/Palette';
import { Localhost } from './components/Localhost';
import { History } from './components/History';
import { Browsers } from './components/Browsers';
import { Ports } from './components/Ports';
import { Scenes } from './components/Scenes';
import { Settings } from './components/Settings';
import { useThumbs } from './useThumbs';
import { syncTitleBar } from './titleBar';

const EMPTY: Snapshot = { apps: [], groups: [], running: {}, crashed: {}, conflicts: [], profiles: [], ports: [] };

export function App({ host }: { host: Host }) {
  const [view, setViewRaw] = useState<View>('home');
  const [manage, setManage] = useState(false);
  /** A card clicked on Home: the Apps or Browsers screen opens straight onto that item. */
  const [focus, setFocus] = useState<{ kind: 'app' | 'browser'; id: string } | null>(null);
  /** 'library' is an alias for Apps in Manage mode; any other jump leaves Manage. */
  const setView = useCallback((v: View) => {
    setManage(v === 'library');
    setFocus(null);
    setViewRaw(v === 'library' ? 'localhost' : v);
  }, []);
  const openItem = useCallback((kind: 'app' | 'browser', id: string) => {
    setManage(kind === 'app');
    setFocus({ kind, id });
    setViewRaw(kind === 'app' ? 'localhost' : 'browsers');
  }, []);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);

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
    const t = setInterval(refresh, 5000);
    const off = host.onChange(refresh);
    return () => { clearInterval(t); off(); };
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

  return (
    <div className="shell" data-nav={prefs.nav}>
      <Sidebar view={view} onView={setView} onSearch={() => setPaletteOpen(true)} />
      <div className="col">
        <TopBar view={view} onView={setView} onSearch={() => setPaletteOpen(true)} />
        <div className="dragbar" aria-hidden="true" />
        <Banner warnings={t.warnings} onFix={() => setView('ports')} />
        <main className="main" id="main">
          {error && <p className="notice" role="alert">Could not read PortPilot state: {error}</p>}
          {view === 'home' && <Home host={host} onDone={refresh} t={t} loaded={loaded} onView={setView} onOpenItem={openItem} snap={snap} thumbs={thumbs} />}
          {view === 'localhost' && <Localhost host={host} snap={snap} thumbs={thumbs} onDone={refresh} manage={manage} onManage={setManage} inspectId={focus?.kind === 'app' ? focus.id : undefined} />}
          {view === 'history' && <History host={host} />}
          {view === 'scenes' && <Scenes host={host} snap={snap} onDone={refresh} />}
          {view === 'ports' && <Ports host={host} snap={snap} onDone={refresh} />}
          {view === 'settings' && <Settings host={host} />}
          {view === 'browsers' && <Browsers host={host} snap={snap} onDone={refresh} editName={focus?.kind === 'browser' ? focus.id : undefined} />}
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} host={host} snap={snap}
        view={view} onView={setView} onDone={refresh} />
    </div>
  );
}
