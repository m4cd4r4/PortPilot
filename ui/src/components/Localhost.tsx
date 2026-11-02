import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Host, Snapshot } from '../host';
import { clusterCards, type Cluster } from '../clusters';
import { STALE_MS, cards, grouped, type Card } from '../model';
import { VIEWS, setPrefs, usePrefs, type Prefs } from '../prefs';
import type { Thumbs } from '../useThumbs';
import { AppInspector } from './AppInspector';
import { Library } from './Library';

interface Props { host: Host; snap: Snapshot; thumbs: Thumbs; onDone: () => void; manage: boolean; onManage: (on: boolean) => void; inspectId?: string }

const HOVER_MS = 500;
const SWEEP_MS = 30000;
/** Stopped apps shown before "Show all"; running and blocked ones always show. */
const STOPPED_SHOWN = 12;

export function Localhost({ host, snap, thumbs, onDone, manage, onManage, inspectId }: Props) {
  const prefs = usePrefs();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [allStopped, setAllStopped] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // Details opened from Home land on the normal Apps view with the panel up.
  const [inspectApp, setInspectApp] = useState<string | undefined>(inspectId);
  const list = useMemo(() => cards(snap, query), [snap, query]);

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

  const showAll = (n: number) => (
    <p className="show-all"><button onClick={() => setAllStopped(true)}>Show all {n} stopped apps</button></p>
  );

  const toggle = (key: string) => setExpandedKeys((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const grid = (rows: Cluster[]) => (
    <div className={`cards ${prefs.view === 'cards' ? 'tiles' : prefs.view}`} data-density={prefs.density} data-status={prefs.status} data-thumbs={prefs.thumbs}>
      {rows.map((cl) => {
        const many = cl.members.length > 1;
        // A search names a branch more often than a project, so it opens every cluster.
        const expanded = many && (!!query || expandedKeys.has(cl.key));
        return (
          <Fragment key={cl.key}>
            <AppCard c={cl.head} title={cl.name} prefs={prefs} thumbs={thumbs} actions={actions}
              more={many ? { count: cl.members.length, open: expanded, toggle: () => toggle(cl.key) } : undefined} />
            {expanded && (
              <div className="members" role="group" aria-label={`${cl.name} copies`}>
                <div className="cards rows" data-density="tight" data-status={prefs.status} data-thumbs="off">
                  {cl.members.map((m) => <AppCard key={m.app.id} c={m} title={m.app.branch || m.app.name} member prefs={prefs} thumbs={thumbs} actions={actions} />)}
                </div>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );

  /** One run of apps: projects that are up first, then the stopped ones behind a count. */
  const section = (list: Card[]) => {
    const clusters = clusterCards(list);
    const active = clusters.filter((c) => c.state !== 'stopped');
    const stopped = clusters.filter((c) => c.state === 'stopped');
    const capped = !allStopped && !query && stopped.length > STOPPED_SHOWN;
    const shown = capped ? stopped.slice(0, STOPPED_SHOWN) : stopped;
    if (!active.length || !stopped.length) return <>{grid(shown.length ? shown : active)}{capped && showAll(stopped.reduce((n, c) => n + c.members.length, 0))}</>;
    return (
      <>
        {grid(active)}
        <h4 className="group-h sub">Stopped<small>{stopped.length}</small></h4>
        {grid(shown)}
        {capped && showAll(stopped.reduce((n, c) => n + c.members.length, 0))}
      </>
    );
  };

  const body = () => {
    if (!snap.apps.length) return <p className="empty-note">No apps yet. Add one with Manage, or start a dev server and PortPilot will notice it.</p>;
    if (!list.length) return <p className="empty-note">No app matches that filter.</p>;
    if (prefs.grouping) {
      return grouped(snap, list).map((g) => (
        <section key={g.id || 'rest'} aria-label={g.name}>
          <h3 className="group-h">{g.name}<small>{g.cards.length}</small></h3>
          {section(g.cards)}
        </section>
      ));
    }
    return section(list);
  };

  if (manage) return <Library host={host} snap={snap} onDone={onDone} onExit={() => onManage(false)} />;

  return (
    <section className="gallery-view" aria-label="Localhost">
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter apps" aria-label="Filter apps" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="toolbar-end">
          <div className="seg small" role="group" aria-label="View mode">
            {VIEWS.map((m) => (
              <button key={m.v} aria-pressed={prefs.view === m.v} className={prefs.view === m.v ? 'on' : ''} onClick={() => setPrefs({ view: m.v })}>{m.l}</button>
            ))}
          </div>
          <button aria-pressed={prefs.grouping} className={prefs.grouping ? 'tog on' : 'tog'} onClick={() => setPrefs({ grouping: !prefs.grouping })}>Grouped</button>
          <button onClick={() => onManage(true)}>Manage</button>
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      {body()}
      {(() => {
        const a = snap.apps.find((x) => x.id === inspectApp);
        return a && <AppInspector host={host} app={a} port={snap.running[a.id]?.port} running={!!snap.running[a.id]}
          crashed={!!snap.crashed[a.id]} onClose={() => setInspectApp(undefined)} />;
      })()}
    </section>
  );
}

interface Actions { open(c: Card): void; start(c: Card): void; stop(c: Card): void }

const GLYPH: Record<Card['state'], string> = { running: '●', conflict: '▲', crashed: '✕', stopped: '○' };
const WORD: Record<Card['state'], string> = { running: 'running', conflict: 'blocked', crashed: 'crashed', stopped: 'stopped' };

interface More { count: number; open: boolean; toggle(): void }

function AppCard({ c, title, more, member, prefs, thumbs, actions }: { c: Card; title?: string; more?: More; member?: boolean; prefs: Prefs; thumbs: Thumbs; actions: Actions }) {
  const thumb = thumbs.byApp[c.app.id];
  // An app with nothing to show drops the screenshot box: a tile of one grey letter is the clutter, not the app.
  const showShot = !member && (prefs.view === 'cards' || prefs.thumbs === 'inline') && (!!thumb || c.state !== 'stopped');
  const peek = !showShot && prefs.thumbs === 'peek' && thumb;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hover = () => {
    if (c.state !== 'running' || !c.port) return;
    clearTimeout(timer.current);
    // The host throttles to one capture per app per 10 s, so a hover storm costs nothing.
    timer.current = setTimeout(() => thumbs.capture(c.app.id, c.port!), HOVER_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <article className={`card ${c.state}${member ? ' member' : ''}`} data-app={c.app.id} data-state={c.state} onMouseEnter={hover} onMouseLeave={() => clearTimeout(timer.current)}>
      {showShot && <button className="shot" onClick={() => actions.open(c)} disabled={c.state !== 'running'} aria-label={`Open ${c.app.name}`}>
        {thumb ? <img src={thumb.url} alt="" loading="lazy" /> : <span className="letter" aria-hidden="true">{c.app.name.slice(0, 1).toUpperCase()}</span>}
        {c.state === 'conflict' && <span className="badge warn">Port held</span>}
        {c.state === 'crashed' && <span className="badge warn">Crashed</span>}
      </button>}
      <div className="meta">
        <div className="title">{prefs.status === 'dot'
          ? <span className={`dot ${c.state}`} aria-hidden="true" />
          : <span className={`stat ${c.state}`}><span aria-hidden="true">{GLYPH[c.state]}</span> {WORD[c.state]}</span>}<span className="name">{title ?? c.app.name}</span></div>
        <div className="sub">
          {c.port ? <span>:{c.port}</span> : <span>no port</span>}
          {!member && c.app.branch && <span className="branch">{c.app.branch}</span>}
          {more && <button className="copies" aria-expanded={more.open} onClick={more.toggle}>{more.open ? '▾' : '▸'} {more.count} copies</button>}
          {c.note && <span className="note">{c.note}</span>}
        </div>
      </div>
      {peek && <img className="peek" src={thumb.url} alt="" loading="lazy" />}
      <div className="acts">
        {c.state === 'running' && <><button onClick={() => actions.open(c)}>Open</button><button onClick={() => actions.stop(c)}>Stop</button></>}
        {c.state !== 'running' && <button onClick={() => actions.start(c)}>Start</button>}
      </div>
    </article>
  );
}
