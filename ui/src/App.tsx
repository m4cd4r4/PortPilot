import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Host, Snapshot } from './host';
import { tally, type View } from './model';
import { TopBar } from './components/TopBar';
import { Home } from './components/Home';
import { Banner } from './components/Banner';
import { Palette } from './components/Palette';
import { Localhost } from './components/Localhost';
import { History } from './components/History';
import { useThumbs } from './useThumbs';

const EMPTY: Snapshot = { apps: [], groups: [], running: {}, crashed: {}, conflicts: [], profiles: [], ports: [] };

export function App({ host }: { host: Host }) {
  const [view, setView] = useState<View>('home');
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

  const t = useMemo(() => tally(snap), [snap]);
  const thumbs = useThumbs(host);

  return (
    <div className="shell">
      <TopBar view={view} onView={setView} onSearch={() => setPaletteOpen(true)} />
      <Banner warnings={t.warnings} onFix={() => setPaletteOpen(true)} />
      <main className="main" id="main">
        {error && <p className="notice" role="alert">Could not read PortPilot state: {error}</p>}
        {view === 'home' && <Home t={t} loaded={loaded} onView={setView} snap={snap} thumbs={thumbs} />}
        {view === 'localhost' && <Localhost host={host} snap={snap} thumbs={thumbs} onDone={refresh} />}
        {view === 'history' && <History host={host} />}
        {view === 'browsers' && (
          <section className="placeholder" aria-label={view}>
            <h2>Browsers</h2>
            <p>This screen is built in a later wave.</p>
          </section>
        )}
      </main>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} host={host} snap={snap}
        view={view} onView={setView} onDone={refresh} />
    </div>
  );
}
