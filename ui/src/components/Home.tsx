import { useEffect, useMemo, useRef, useState } from 'react';
import type { Host, Profile, Run, Scene, Snapshot } from '../host';
import { ago, hueOf, type Card, type Tally, type View } from '../model';
import { homeLists, lastRuns } from '../homeModel';
import { runView } from '../legacy';
import { sceneRun, sceneSummary, startScene, stopScene } from '../scenes';
import { usePrefs } from '../prefs';
import type { Thumbs } from '../useThumbs';
import { appBlocked, openApp as openAppRule, openBrowser, profileBlocked, type TileNotice } from '../tileRule';
import { TileNoticeLine } from './TileNoticeLine';

interface Props { host: Host; t: Tally; loaded: boolean; onView: (v: View) => void; onPorts: (port?: number) => void; onOpenItem: (kind: 'app' | 'browser', id: string) => void; snap: Snapshot; thumbs: Thumbs; onDone: () => void }

const KEY = 'portpilot-home-tally';
/** Two rows of running tiles; the rest are one click away on Apps. */
const RUN_TILES = 8;
const SCENE_KEY = 'portpilot-home-scene';
type Counts = Pick<Tally, 'running' | 'apps' | 'profilesUp' | 'profiles'>;

function lastCounts(): Counts | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && ['running', 'apps', 'profilesUp', 'profiles'].every((k) => Number.isInteger(v[k]))) return v;
  } catch { /* storage can be unavailable */ }
  return null;
}

/** One flat, muted tint per name: behind a running tile whose picture has not been taken yet. */
const gradient = (name: string) => `hsl(${hueOf(name)} 26% 22%)`;

const lastRunText = (iso: string | undefined) => {
  const a = ago(iso);
  return !a ? '' : a === 'just now' ? a : `${a} ago`;
};

/**
 * Home: running apps as picture tiles (a running app nearly always has a picture), then open browsers and
 * recently used apps as rows (a stopped app often has none, and worktree copies of one site look alike).
 * An app is under Running or under Recently used, never both. The lists come from homeModel.homeLists.
 */
export function Home({ host, t, loaded, onView, onPorts, onOpenItem, snap, thumbs, onDone }: Props) {
  const prefs = usePrefs();
  // The first read takes a couple of seconds on a big library: show the last known counts, dimmed, and no rows yet.
  const last = loaded ? null : lastCounts();
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify({ running: t.running, apps: t.apps, profilesUp: t.profilesUp, profiles: t.profiles })); } catch { /* ignore */ }
  }, [loaded, t.running, t.apps, t.profilesUp, t.profiles]);
  const num = (n: number, k: keyof Counts) => (loaded ? String(n) : last ? String(last[k]) : '');

  const [runs, setRuns] = useState<Run[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneNote, setSceneNote] = useState('');
  const [notice, setNotice] = useState<TileNotice | null>(null);
  const [sceneId, setSceneId] = useState(() => { try { return localStorage.getItem(SCENE_KEY) || ''; } catch { return ''; } });
  useEffect(() => {
    let off = false;
    host.history().then((h) => { if (!off) setRuns(h.runs); }).catch(() => { /* Home still works without a history */ });
    return () => { off = true; };
  }, [host, t.running]);
  useEffect(() => {
    let off = false;
    host.scenes().then((s) => { if (!off) setScenes(s); }).catch(() => { /* no scenes card content */ });
    return () => { off = true; };
  }, [host]);

  const { running, recent, browsers } = useMemo(() => homeLists(snap, runs), [snap, runs]);
  const started = useMemo(() => lastRuns(runs), [runs]);

  const scene = scenes.find((x) => x.id === sceneId) ?? scenes[0];
  const pickScene = (id: string) => {
    setSceneId(id);
    setSceneNote('');
    try { localStorage.setItem(SCENE_KEY, id); } catch { /* storage can be unavailable */ }
  };
  // A scene is "on" while anything it started is still up, so the button offers Stop instead of Start.
  const sceneOn = (() => {
    const r = scene ? sceneRun(scene.id) : null;
    return !!r && (r.apps.some((id) => snap.running[id]) || r.browsers.some((n) => snap.profiles.find((p) => p.name === n)?.state === 'up'));
  })();

  // A running app with no picture yet gets one capture; the host throttles and a failed try is not repeated.
  const tried = useRef(new Set<string>());
  const nextShot = running.find((c) => c.port && !thumbs.byApp[c.app.id] && !tried.current.has(c.app.id));
  useEffect(() => {
    if (!nextShot) return;
    tried.current.add(nextShot.app.id);
    thumbs.capture(nextShot.app.id, nextShot.port!).catch(() => { /* the tile keeps its tint */ });
  }, [nextShot, thumbs]);

  const run = (fn: () => Promise<unknown>) => {
    setNotice(null);
    fn().catch((e) => setNotice({ text: (e as Error)?.message || 'That did not work.' })).finally(onDone);
  };
  // Every tile and row follows the one rule in tileRule.ts: running opens, stopped starts then opens, a taken port says why.
  const openApp = (c: Card) => {
    const why = appBlocked(snap, c.app);
    if (why) { setNotice(why); return; }
    run(() => openAppRule(host, c.app));
  };
  const startApp = (c: Card) => {
    const why = appBlocked(snap, c.app);
    if (why) setNotice(why); else run(() => host.startApp(c.app));
  };
  const openProfile = (p: Profile) => {
    const why = profileBlocked(p);
    if (why) { setNotice(why); return; }
    run(() => openBrowser(host, p));
  };
  const tileLabel = (c: Card) => (c.state === 'running' && c.port ? `Open ${c.app.name}` : `Start and open ${c.app.name}`);
  const profileLabel = (p: Profile) => (p.state === 'up' ? `Show ${p.name}` : p.state === 'blocked' ? `Why ${p.name} cannot start` : `Start ${p.name}`);
  const empty = loaded && snap.apps.length === 0;

  return (
    <section className={`home${scene ? ' has-scene' : ''}${loaded ? '' : last ? ' stale' : ' loading'}`} aria-label="Home" aria-busy={!loaded}>
      <div className="tile h-hero">
        <TileNoticeLine notice={notice} onPorts={onPorts} onClose={() => setNotice(null)} />
        {empty ? (
          <div className="run-row">
            <div className="row-main wrap">
              <h2>Welcome to PortPilot</h2>
              <span className="tile-sub">Add a project folder. PortPilot finds the start command and a free port, and you press Start.</span>
            </div>
            <div className="row-actions"><button className="primary" onClick={() => onView('library')}>Add an app</button></div>
          </div>
        ) : (
          <>
            <div className="h2-head">
              <button className="link" onClick={() => onView('localhost')}>Running</button>
              <span className="tile-sub">{num(t.running, 'running')} of {num(t.apps, 'apps')} apps</span>
            </div>
            {loaded && running.length > 0 && (
              <div className="run-grid">
                {running.slice(0, RUN_TILES).map((c) => {
                  const shot = thumbs.byApp[c.app.id]?.url;
                  const at = lastRunText(started.get(c.app.id));
                  return (
                    <div className="run-row" key={c.app.id}>
                      <button className="th-wrap row-wrap" title={tileLabel(c)} aria-label={tileLabel(c)} onClick={() => openApp(c)}>
                        <span className="th row-th" style={shot ? { backgroundImage: `url(${shot})` } : { background: gradient(c.app.name) }} />
                      </button>
                      <div className="row-main">
                        <h2>{prefs.status === 'dot'
                          ? <span className="dot on" />
                          : <span className="stat-word"><span aria-hidden="true">●</span> running</span>}<span className="nm">{c.app.name}</span></h2>
                        <span className="tile-sub">{[c.port ? `:${c.port}` : '', at ? `started ${at}` : '', runView().startedByLabel(c.startedBy)].filter(Boolean).join(' · ')}</span>
                      </div>
                      <button className="chip chip-tr" title="Details" onClick={() => onOpenItem('app', c.app.id)}>
                        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" /></svg>
                        <span className="sr">Details</span>
                      </button>
                      <button className="chip chip-br" title="Stop" onClick={() => run(() => host.stopApp(c.app.id))}>
                        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" /></svg>
                        <span className="sr">Stop</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {loaded && running.length === 0 && <span className="tile-sub h2-none">Nothing is running</span>}
            {running.length > RUN_TILES && <button className="link more-link" onClick={() => onView('localhost')}>+{running.length - RUN_TILES} more running</button>}
          </>
        )}
      </div>

      {!empty && (
      <div className="tile h-recent">
        <div className="h2-head"><button className="link" onClick={() => onView('localhost')}>Recently used</button></div>
        {loaded && recent.map((c) => (
          <div className="h2-row" key={c.app.id}>
            <button className="h2-main" title={tileLabel(c)} onClick={() => openApp(c)}>
              <span className="dot" /><span className="nm">{c.app.name}</span>
              <span className="h2-meta">{[c.port ? `:${c.port}` : '', lastRunText(started.get(c.app.id))].filter(Boolean).join(' · ')}</span>
            </button>
            <button className="h2-act" aria-label={`Start ${c.app.name}`} onClick={() => startApp(c)}>Start</button>
          </div>
        ))}
        {loaded && recent.length === 0 && <span className="tile-sub h2-none">Apps you run will show up here</span>}
      </div>
      )}

      <div className="tile h-browsers">
        <div className="h2-head">
          <button className="link" onClick={() => onView('browsers')}>Browsers</button>
          <span className="tile-sub">{num(t.profilesUp, 'profilesUp')} open of {num(t.profiles, 'profiles')}</span>
        </div>
        {loaded && browsers.map((p) => (
          <div className="h2-row" key={p.name}>
            <button className="h2-main" title={profileLabel(p)} onClick={() => openProfile(p)}>
              <span className={`dot${p.state === 'up' ? ' on' : ''}`} /><span className="nm">{p.name}</span>
              <span className="h2-meta">{[p.port ? `:${p.port}` : '', p.state === 'up' ? (p.leasedTo ? 'in use' : 'open') : p.state === 'blocked' ? 'port taken' : ''].filter(Boolean).join(' · ')}</span>
            </button>
            {p.state !== 'up' && p.state !== 'blocked' && <button className="h2-act" aria-label={`Start ${p.name}`} onClick={() => openProfile(p)}>Start</button>}
          </div>
        ))}
        {loaded && browsers.length === 0 && <span className="tile-sub h2-none">No browser profiles yet</span>}
      </div>

      {scene && (
      <div className="tile h-scene">
        <span className="tile-title">Scene</span>
        {scenes.length > 1
          ? <select className="scene-pick" aria-label="Scene" value={scene.id} onChange={(e) => pickScene(e.target.value)}>{scenes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          : <b>{scene.name}</b>}
        <span className="tile-sub">{sceneNote || sceneSummary(scene)}</span>
        {sceneOn
          ? <button className="primary" onClick={() => run(async () => { setSceneNote(`Stopped ${(await stopScene(host, scene)).length}`); })}>Stop</button>
          : <button className="primary" onClick={() => run(async () => {
            const r = await startScene(host, scene);
            setSceneNote(r.failed.length ? `${r.failed.length} could not start` : `Started ${r.started.length}`);
          })}>Start</button>}
      </div>
      )}
    </section>
  );
}
