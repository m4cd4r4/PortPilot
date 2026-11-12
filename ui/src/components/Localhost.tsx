import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { every } from '../poll';
import type { Host, Snapshot } from '../host';
import { clusterCards, type Cluster } from '../clusters';
import { runView } from '../legacy';
import { STALE_MS, cards, type Card } from '../model';
import { OLDER_DAYS, loadLastRuns, olderIds, projectsOf, pruneOpen, rememberedRuns, sections, type Section } from '../projects';
import { APP_VIEWS, gridClass, setPrefs, showsShot, usePrefs, type Prefs } from '../prefs';
import type { Thumbs } from '../useThumbs';
import { appBlockedNow, openApp, type TileNotice } from '../tileRule';
import { AppInspector } from './AppInspector';
import { TileNoticeLine } from './TileNoticeLine';
import { IconButton } from './icons';
import { Library } from './Library';

interface Props { host: Host; snap: Snapshot; loaded: boolean; thumbs: Thumbs; onDone: () => void; manage: boolean; onManage: (on: boolean) => void; inspectId?: string; onPorts: (port?: number) => void }

const HOVER_MS = 500;
const SWEEP_MS = 30000;
/** Stopped apps shown before "Show all"; running and crashed ones always show. */
const STOPPED_SHOWN = 12;
/** Past this many apps, a section with nothing running starts folded: the page opens on what is up. */
const FOLD_AT = 30;
const OPEN_KEY = 'portpilot-apps-open';

/** Sections the person opened or folded by hand, by section id. */
function savedOpen(): Record<string, boolean> {
  try {
    const j = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

const apps = (n: number) => `${n} ${n === 1 ? 'app' : 'apps'}`;

export function Localhost({ host, snap, loaded, thumbs, onDone, manage, onManage, inspectId, onPorts }: Props) {
  const prefs = usePrefs();
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<TileNotice | null>(null);
  const [allStopped, setAllStopped] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [openById, setOpenById] = useState<Record<string, boolean>>(savedOpen);
  const [showOlder, setShowOlder] = useState(false);
  const [lastRun, setLastRun] = useState<Record<string, number>>(rememberedRuns);
  // Details opened from Home land on the normal Apps view with the panel up.
  const [inspectApp, setInspectApp] = useState<string | undefined>(inspectId);
  const list = useMemo(() => cards(snap, query), [snap, query]);
  const projects = useMemo(() => projectsOf(snap.apps, snap.roots), [snap.apps, snap.roots]);

  // When each app last ran, for the "older" fold. Read again when an app starts or stops.
  const runningCount = Object.keys(snap.running).length;
  const appsRef = useRef(snap.apps);
  appsRef.current = snap.apps;
  useEffect(() => {
    let off = false;
    // No history, or no app list yet: nothing folds that was not already known.
    loadLastRuns(() => host.history(), () => appsRef.current).then((runs) => { if (!off && runs) setLastRun(runs); });
    return () => { off = true; };
  }, [host, runningCount, snap.apps.length]);

  // A filter looks everywhere: nothing is folded away from a search.
  const older = useMemo(() => (query ? new Set<string>() : olderIds(list, lastRun, Date.now())), [list, lastRun, query]);
  const fresh = useMemo(() => (older.size ? list.filter((c) => !older.has(c.app.id)) : list), [list, older]);
  const old = useMemo(() => list.filter((c) => older.has(c.app.id)), [list, older]);

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
    const stop = every(sweep, SWEEP_MS);
    return () => { clearTimeout(first); stop(); };
  }, []);

  const act = async (fn: () => Promise<void>) => {
    try { setNotice(null); await fn(); onDone(); } catch (e) { setNotice({ text: (e as Error).message }); }
  };
  const open = (c: Card) => c.port && act(() => host.openUrl(`http://localhost:${c.port}`));
  // A taken port is reported here, when Start is pressed, and nowhere before it. It is explained,
  // not retried: the host would only fail the same way. The host is asked at the click: this
  // page's snapshot can be a poll old, and would refuse a port the app itself freed a second ago.
  const blockedOr = async (c: Card, fn: () => void) => {
    let why: TileNotice | null;
    try { why = await appBlockedNow(host, c.app); } catch (e) { setNotice({ text: (e as Error).message }); return; }
    if (why) setNotice(why); else fn();
  };
  const actions: Actions = {
    open,
    start: (c) => blockedOr(c, () => act(() => host.startApp(c.app))),
    stop: (c) => act(() => host.stopApp(c.app.id)),
    tile: (c) => blockedOr(c, () => act(() => openApp(host, c.app))),
  };

  // Show all, Show older and Hide take away the button that was pressed: focus moves to what they revealed.
  const uid = useId();
  const olderId = `${uid}older`;
  const [focusOn, setFocusOn] = useState('');
  useEffect(() => {
    if (!focusOn) return;
    document.querySelector<HTMLElement>(focusOn)?.focus();
    setFocusOn('');
  }, [focusOn]);

  const showAll = (id: string, n: number) => (
    <p className="show-all"><button onClick={() => {
      setAllStopped((o) => new Set(o).add(id));
      setFocusOn(`[data-stopped=${JSON.stringify(id)}] > article:nth-of-type(${STOPPED_SHOWN + 1}) button`);
    }}>Show all {n} stopped apps</button></p>
  );

  const toggle = (key: string) => setExpandedKeys((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // Saved choices for sections that no longer exist are dropped here. The ids come from the whole
  // library, so a section whose apps are all under "older" just now keeps its choice.
  const setOpen = (id: string, open: boolean) => setOpenById((o) => {
    const ids = sections(cards(snap, ''), snap.groups, projects).map((s) => s.id);
    const n = { ...pruneOpen(o, ids), [id]: open };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* storage can be unavailable */ }
    return n;
  });

  const grid = (rows: Cluster[], stoppedOf?: string) => (
    <div className={`cards ${gridClass(prefs.view)}`} data-stopped={stoppedOf} data-density={prefs.density} data-status={prefs.status} data-thumbs={prefs.thumbs}>
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

  /**
   * One run of apps: the ones that are up first, then the stopped ones behind a count. Every number
   * here counts apps, so a heading, the Stopped line and Show all agree; a row can hold several copies.
   */
  const section = (id: string, list: Card[]) => {
    const clusters = clusterCards(list);
    const active = clusters.filter((c) => c.state !== 'stopped');
    const stopped = clusters.filter((c) => c.state === 'stopped');
    const stoppedApps = stopped.reduce((n, c) => n + c.members.length, 0);
    const capped = !allStopped.has(id) && !query && stopped.length > STOPPED_SHOWN;
    const shown = capped ? stopped.slice(0, STOPPED_SHOWN) : stopped;
    if (!active.length || !stopped.length) return <>{shown.length ? grid(shown, id) : grid(active)}{capped && showAll(id, stoppedApps)}</>;
    return (
      <>
        {grid(active)}
        <h4 className="group-h sub">Stopped<small>{stoppedApps}</small></h4>
        {grid(shown, id)}
        {capped && showAll(id, stoppedApps)}
      </>
    );
  };

  /** A group or project with its heading. In a big library a section with nothing running starts folded. */
  const block = (sec: Section, folds: boolean, index: number) => {
    const open = !!query || (openById[sec.id] ?? (sec.active || !folds));
    const up = sec.cards.filter((c) => c.state === 'running').length;
    const down = sec.cards.filter((c) => c.state === 'crashed').length;
    const bodyId = `${uid}s${index}`;
    return (
      <section key={sec.id || 'rest'} aria-label={sec.name} data-section={sec.kind} data-open={open}>
        <h3 className="group-h">
          {/* A filter opens every section; a click then would save "folded" with nothing to show for it. */}
          <button className="fold" aria-expanded={open} aria-controls={bodyId} aria-disabled={!!query || undefined}
            onClick={() => { if (!query) setOpen(sec.id, !open); }}>{sec.name}</button>
          <small>{sec.cards.length}</small>
          {!open && up > 0 && <small className="up">{up} running</small>}
          {!open && down > 0 && <small className="down">{down} crashed</small>}
        </h3>
        <div id={bodyId} hidden={!open}>{open && section(sec.id, sec.cards)}</div>
      </section>
    );
  };

  /** Apps not run in 30 days: one line at the foot of the page until asked for. */
  const olderBlock = () => {
    if (!old.length) return null;
    const why = `not run in ${OLDER_DAYS()} days`;
    // Nothing recent at all: the older apps are the page, not a footnote.
    if (!showOlder && fresh.length) {
      return (
        <p className="show-all older">
          <button aria-expanded={false} aria-label={`Show older: ${apps(old.length)} ${why}`}
            onClick={() => { setShowOlder(true); setFocusOn('section[data-section="older"] h3'); }}>Show older</button>
          <span aria-hidden="true">{apps(old.length)} {why}</span>
        </p>
      );
    }
    return (
      <section aria-label="Older" data-section="older">
        <div className="group-head">
          <h3 className="group-h" tabIndex={-1}>Older<small>{old.length}</small><small>{why}</small></h3>
          {fresh.length > 0 && <button className="fold-link" aria-expanded aria-controls={olderId}
            onClick={() => { setShowOlder(false); setFocusOn('.show-all.older button'); }}>Hide</button>}
        </div>
        <div id={olderId}>{grid(clusterCards(old))}</div>
      </section>
    );
  };

  const body = () => {
    // Until the first read lands the library is unknown: saying "No apps yet" then would be a guess.
    if (!loaded && !snap.apps.length) return <p className="empty-note reading" role="status">Reading your apps</p>;
    if (!snap.apps.length) return <p className="empty-note">No apps yet. Add one with Manage, or start a dev server and PortPilot will notice it.</p>;
    if (!list.length) return <p className="empty-note">No app matches that filter.</p>;
    if (!prefs.grouping) return <>{fresh.length > 0 && section('', fresh)}{olderBlock()}</>;
    const secs = sections(fresh, snap.groups, projects);
    const folds = fresh.length > FOLD_AT && secs.length > 1;
    return <>{secs.map((sec, i) => block(sec, folds, i))}{olderBlock()}</>;
  };

  if (manage) return <Library host={host} snap={snap} loaded={loaded} onDone={onDone} onExit={() => onManage(false)} />;

  return (
    <section className="gallery-view" aria-label="Localhost" aria-busy={!loaded || undefined}>
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter apps" aria-label="Filter apps" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="toolbar-end">
          <div className="seg small" role="group" aria-label="View mode">
            {APP_VIEWS.map((m) => (
              <button key={m.v} aria-pressed={prefs.view === m.v} className={prefs.view === m.v ? 'on' : ''} onClick={() => setPrefs({ view: m.v })}>{m.l}</button>
            ))}
          </div>
          <button aria-pressed={prefs.grouping} className={prefs.grouping ? 'tog on' : 'tog'} onClick={() => setPrefs({ grouping: !prefs.grouping })}>Grouped</button>
          <button onClick={() => onManage(true)}>Manage</button>
        </div>
      </div>
      <TileNoticeLine notice={notice} onPorts={onPorts} onClose={() => setNotice(null)} />
      {body()}
      {(() => {
        const a = snap.apps.find((x) => x.id === inspectApp);
        return a && <AppInspector host={host} app={a} port={snap.running[a.id]?.port} running={!!snap.running[a.id]}
          crashed={!!snap.crashed[a.id]} onClose={() => setInspectApp(undefined)} />;
      })()}
    </section>
  );
}

interface Actions { open(c: Card): void; start(c: Card): void; stop(c: Card): void; tile(c: Card): void }

const GLYPH: Record<Card['state'], string> = { running: '●', crashed: '✕', stopped: '○' };
const WORD: Record<Card['state'], string> = { running: 'running', crashed: 'crashed', stopped: 'stopped' };

/** The picture is the shortcut: running opens, stopped starts then opens (a taken port is said then). */
const tileLabel = (c: Card) => (c.state === 'running' ? `Open ${c.app.name}` : `Start and open ${c.app.name}`);

interface More { count: number; open: boolean; toggle(): void }

function AppCard({ c, title, more, member, prefs, thumbs, actions }: { c: Card; title?: string; more?: More; member?: boolean; prefs: Prefs; thumbs: Thumbs; actions: Actions }) {
  const thumb = thumbs.byApp[c.app.id];
  const by = c.state === 'running' ? runView().startedByLabel(c.startedBy) : '';
  // An app with nothing to show drops the screenshot box: a tile of one grey letter is the clutter, not the app.
  const showShot = !member && (showsShot(prefs.view) || prefs.thumbs === 'inline') && (!!thumb || c.state !== 'stopped');
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
      {showShot && <button className="shot" onClick={() => actions.tile(c)} aria-label={tileLabel(c)} title={tileLabel(c)}>
        {thumb ? <img src={thumb.url} alt="" loading="lazy" /> : <span className="letter" aria-hidden="true">{c.app.name.slice(0, 1).toUpperCase()}</span>}
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
          {by && <span className="by" title={by}>{by}</span>}
        </div>
      </div>
      {peek && <img className="peek" src={thumb.url} alt="" loading="lazy" />}
      <div className="acts">
        {c.state === 'running' && <><IconButton icon="open" label="Open" tip={`Open ${c.app.name} in the browser`} onClick={() => actions.open(c)} />
          <IconButton icon="stop" label="Stop" tip={`Stop ${c.app.name}`} onClick={() => actions.stop(c)} /></>}
        {c.state !== 'running' && <IconButton icon="start" label="Start" tip={`Start ${c.app.name}`} onClick={() => actions.start(c)} />}
      </div>
    </article>
  );
}
