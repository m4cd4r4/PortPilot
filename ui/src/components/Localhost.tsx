import { useEffect, useMemo, useRef, useState } from 'react';
import type { Host, Snapshot } from '../host';
import { MODES, STALE_MS, cards, grouped, type Card, type Mode } from '../model';
import type { Thumbs } from '../useThumbs';

interface Props { host: Host; snap: Snapshot; thumbs: Thumbs; onDone: () => void }

const MODE_KEY = 'portpilot-localhost-mode';
const HOVER_MS = 500;
const SWEEP_MS = 30000;
/** Stopped apps shown before "Show all"; running and blocked ones always show. */
const STOPPED_SHOWN = 12;

function loadMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (MODES.some((m) => m.mode === v)) return v as Mode;
  } catch { /* storage can be unavailable */ }
  return 'gallery';
}

export function Localhost({ host, snap, thumbs, onDone }: Props) {
  const [mode, setMode] = useState<Mode>(loadMode);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [allStopped, setAllStopped] = useState(false);
  const list = useMemo(() => cards(snap, query), [snap, query]);

  const pick = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  };

  // Keep running apps' screenshots fresh: one stale app per sweep, so captures never pile up.
  const latest = useRef({ list, thumbs });
  latest.current = { list, thumbs };
  useEffect(() => {
    const sweep = () => {
      const { list: l, thumbs: t } = latest.current;
      const now = Date.now();
      const due = l
        .filter((c) => c.state === 'running' && c.port)
        .map((c) => ({ c, age: now - (t.byApp[c.app.id]?.at ?? 0) }))
        .filter((x) => x.age > STALE_MS)
        .sort((a, b) => b.age - a.age)[0];
      if (due) t.capture(due.c.app.id, due.c.port!);
    };
    const first = setTimeout(sweep, 1500);
    const id = setInterval(sweep, SWEEP_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);

  const act = async (fn: () => Promise<void>) => {
    try { setError(''); await fn(); onDone(); } catch (e) { setError((e as Error).message); }
  };
  const open = (c: Card) => c.port && act(() => host.openUrl(`http://localhost:${c.port}`));
  const actions = {
    open,
    start: (c: Card) => act(() => host.startApp(c.app)),
    stop: (c: Card) => act(() => host.stopApp(c.app.id)),
  };

  const showAll = () => (
    <p className="show-all"><button onClick={() => setAllStopped(true)}>Show all {list.filter((c) => c.state === 'stopped').length} stopped apps</button></p>
  );

  const body = () => {
    if (!snap.apps.length) return <p className="empty-note">No apps yet. Add one from the Library, or start a dev server and PortPilot will notice it.</p>;
    if (!list.length) return <p className="empty-note">No app matches that filter.</p>;
    if (mode === 'grouped') {
      return grouped(snap, list).map((g) => (
        <section key={g.id || 'rest'} aria-label={g.name}>
          <h3 className="group-h">{g.name}<small>{g.cards.length}</small></h3>
          <div className="cards gallery">{g.cards.map((c) => <AppCard key={c.app.id} c={c} mode="gallery" thumbs={thumbs} actions={actions} />)}</div>
        </section>
      ));
    }
    const active = list.filter((c) => c.state !== 'stopped');
    const stopped = list.filter((c) => c.state === 'stopped');
    const capped = !allStopped && !query && stopped.length > STOPPED_SHOWN;
    const shown = capped ? stopped.slice(0, STOPPED_SHOWN) : stopped;
    const grid = (rows: Card[]) => <div className={`cards ${mode}`}>{rows.map((c) => <AppCard key={c.app.id} c={c} mode={mode} thumbs={thumbs} actions={actions} />)}</div>;
    if (!active.length || !stopped.length) return <>{grid(shown.length ? shown : active)}{capped && showAll()}</>;
    return (
      <>
        {grid(active)}
        <h3 className="group-h">Stopped<small>{stopped.length}</small></h3>
        {grid(shown)}
        {capped && showAll()}
      </>
    );
  };

  return (
    <section className="gallery-view" aria-label="Localhost">
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter apps" aria-label="Filter apps" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="seg small" role="group" aria-label="View mode">
          {MODES.map((m) => (
            <button key={m.mode} aria-pressed={mode === m.mode} className={mode === m.mode ? 'on' : ''} onClick={() => pick(m.mode)}>{m.label}</button>
          ))}
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      {body()}
    </section>
  );
}

interface Actions { open(c: Card): void; start(c: Card): void; stop(c: Card): void }

function AppCard({ c, mode, thumbs, actions }: { c: Card; mode: Mode; thumbs: Thumbs; actions: Actions }) {
  const thumb = thumbs.byApp[c.app.id];
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hover = () => {
    if (c.state !== 'running' || !c.port) return;
    clearTimeout(timer.current);
    // The host throttles to one capture per app per 10 s, so a hover storm costs nothing.
    timer.current = setTimeout(() => thumbs.capture(c.app.id, c.port!), HOVER_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <article className={`card ${c.state}`} data-app={c.app.id} data-state={c.state} onMouseEnter={hover} onMouseLeave={() => clearTimeout(timer.current)}>
      <button className="shot" onClick={() => actions.open(c)} disabled={c.state !== 'running'} aria-label={`Open ${c.app.name}`}>
        {thumb ? <img src={thumb.url} alt="" loading="lazy" /> : <span className="letter" aria-hidden="true">{c.app.name.slice(0, 1).toUpperCase()}</span>}
        {c.state === 'conflict' && <span className="badge warn">Port held</span>}
        {c.state === 'crashed' && <span className="badge warn">Crashed</span>}
      </button>
      <div className="meta">
        <div className="title"><span className={`dot ${c.state}`} aria-hidden="true" /><span className="name">{c.app.name}</span></div>
        <div className="sub">
          {c.port ? <span>:{c.port}</span> : <span>no port</span>}
          {c.app.branch && <span className="branch">{c.app.branch}</span>}
          {mode !== 'compact' && c.note && <span className="note">{c.note}</span>}
        </div>
      </div>
      <div className="acts">
        {c.state === 'running' && <><button onClick={() => actions.open(c)}>Open</button><button onClick={() => actions.stop(c)}>Stop</button></>}
        {c.state !== 'running' && <button onClick={() => actions.start(c)}>Start</button>}
      </div>
    </article>
  );
}
