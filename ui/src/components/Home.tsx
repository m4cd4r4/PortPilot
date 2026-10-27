import { useEffect, useMemo, useRef, useState } from 'react';
import type { Host, Run, Scene, Snapshot } from '../host';
import { ago, cards, groupOf, hueOf, type Card, type Tally, type View } from '../model';
import { sceneRun, sceneSummary, startScene, stopScene } from '../scenes';
import type { Thumbs } from '../useThumbs';
import { useBrowserArt } from '../useBrowserMeta';

interface Props { host: Host; t: Tally; loaded: boolean; onView: (v: View) => void; snap: Snapshot; thumbs: Thumbs; onDone: () => void }

const KEY = 'portpilot-home-tally';
const RUN_ROWS = 5;
const SCENE_KEY = 'portpilot-home-scene';
type Counts = Pick<Tally, 'running' | 'apps' | 'profilesUp' | 'profiles'>;

function lastCounts(): Counts | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && ['running', 'apps', 'profilesUp', 'profiles'].every((k) => Number.isInteger(v[k]))) return v;
  } catch { /* storage can be unavailable */ }
  return null;
}

const gradient = (name: string) => `linear-gradient(135deg, hsl(${hueOf(name)} 55% 32%), hsl(${(hueOf(name) + 40) % 360} 50% 16%))`;

/** Latest start per app, newest first, from run history. */
function lastRuns(runs: Run[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of runs) {
    if (!r.appId || !r.startedAt) continue;
    const prev = out.get(r.appId);
    if (!prev || Date.parse(r.startedAt) > Date.parse(prev)) out.set(r.appId, r.startedAt);
  }
  return new Map([...out].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])));
}

const lastRunText = (iso: string | undefined) => {
  const a = ago(iso);
  return !a ? '' : a === 'just now' ? a : `${a} ago`;
};

export function Home({ host, t, loaded, onView, snap, thumbs, onDone }: Props) {
  // The first read takes a couple of seconds on a big library: show the last known counts, dimmed, instead of dashes.
  const last = loaded ? null : lastCounts();
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify({ running: t.running, apps: t.apps, profilesUp: t.profilesUp, profiles: t.profiles })); } catch { /* ignore */ }
  }, [loaded, t.running, t.apps, t.profilesUp, t.profiles]);
  const num = (n: number, k: keyof Counts) => (loaded ? String(n) : last ? String(last[k]) : '');

  const [runs, setRuns] = useState<Run[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneNote, setSceneNote] = useState('');
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
  const art = useBrowserArt(host, []);

  const all = useMemo(() => cards(snap), [snap]);
  const recent = useMemo(() => lastRuns(runs), [runs]);
  // Hero: the most recently started app that is up now, else the most recently run one, else the first card.
  const hero: Card | undefined = useMemo(() => {
    const top = all.filter((c) => !c.app.parentId);
    const byRecent = (list: Card[]) => [...list].sort((a, b) => Date.parse(recent.get(b.app.id) || '') - Date.parse(recent.get(a.app.id) || '') || 0);
    const up = byRecent(top.filter((c) => c.state === 'running'));
    return up[0] ?? byRecent(top.filter((c) => recent.has(c.app.id)))[0] ?? top[0];
  }, [all, recent]);
  const runningList = useMemo(() => {
    const up = all.filter((c) => !c.app.parentId && c.state === 'running');
    return [...up].sort((a, b) => Date.parse(recent.get(b.app.id) || '') - Date.parse(recent.get(a.app.id) || '') || 0);
  }, [all, recent]);
  const strip = useMemo(() => {
    const byId = new Map(all.map((c) => [c.app.id, c]));
    return [...recent.keys()].map((id) => byId.get(id)).filter((c): c is Card => !!c && !c.app.parentId && c.app.id !== hero?.app.id).slice(0, 5);
  }, [all, recent, hero]);

  const profiles = useMemo(
    () => [...snap.profiles].sort((a, b) => Number(b.state === 'up') - Number(a.state === 'up') || (Date.parse(b.lastUsed || '') || 0) - (Date.parse(a.lastUsed || '') || 0) || a.name.localeCompare(b.name)).slice(0, 3),
    [snap.profiles],
  );
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

  // A running app with no picture yet gets one capture, hero first; the host throttles and a failed try is not repeated.
  const tried = useRef(new Set<string>());
  const missing = all.filter((c) => c.state === 'running' && c.port && !thumbs.byApp[c.app.id] && !tried.current.has(c.app.id))
    .sort((x, y) => Number(y.app.id === hero?.app.id) - Number(x.app.id === hero?.app.id));
  const nextShot = missing[0];
  useEffect(() => {
    if (!nextShot) return;
    tried.current.add(nextShot.app.id);
    thumbs.capture(nextShot.app.id, nextShot.port!).catch(() => { /* the card keeps its gradient */ });
  }, [nextShot, thumbs]);

  const heroLast = hero ? lastRunText(recent.get(hero.app.id)) : '';
  const heroSetUp = hero?.app.createdAt && Number.isFinite(Date.parse(hero.app.createdAt))
    ? new Date(hero.app.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const heroGroup = hero ? snap.groups.find((g) => g.id === groupOf(hero.app))?.name : undefined;
  const facts: Array<[string, string]> = hero ? ([
    ['Project', heroGroup || ''],
    ['Port', hero.port ? `:${hero.port}` : ''],
    ['Last run', heroLast],
    ['Set up', heroSetUp],
    ['Path', hero.app.cwd || ''],
  ] as Array<[string, string]>).filter(([, v]) => v) : [];
  const heroShot = hero ? thumbs.byApp[hero.app.id]?.url : undefined;
  // Open an app's page; a stopped one is started first and opened as soon as it answers.
  const openApp = (c: Card) => run(async () => {
    const url = (port: number) => `http://localhost:${port}`;
    // Ask the host, not the card: the card can be a poll behind.
    const now = (await host.snapshot()).running[c.app.id]?.port;
    if (now) { await host.openUrl(url(now)); return; }
    await host.startApp(c.app);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 750));
      const port = (await host.snapshot()).running[c.app.id]?.port;
      if (port) { await host.openUrl(url(port)); return; }
    }
    onView('localhost');
  });
  const run = (fn: () => Promise<void>) => { fn().catch(() => { /* the card state shows what happened */ }).finally(onDone); };

  return (
    <section className={`home${scene ? ' has-scene' : ''}${loaded ? '' : last ? ' stale' : ' loading'}`} aria-label="Home" aria-busy={!loaded}>
      <div className="tile h-hero">
        {hero ? (
          <>
            <span className="tile-title">{runningList.length ? `Running, ${runningList.length} of ${t.apps} apps` : 'Last used'}</span>
            {(runningList.length ? runningList.slice(0, RUN_ROWS) : [hero]).map((c) => {
              const shot = thumbs.byApp[c.app.id]?.url;
              const last = lastRunText(recent.get(c.app.id));
              return (
                <div className="run-row" key={c.app.id}>
                  <span className="th row-th" style={shot ? { backgroundImage: `url(${shot})` } : { background: gradient(c.app.name) }} />
                  <div className="row-main">
                    <h2><span className={`dot${c.state === 'running' ? ' on' : ''}`} />{c.app.name}</h2>
                    <span className="tile-sub">{[c.port ? `:${c.port}` : '', last ? (c.state === 'running' ? `started ${last}` : `last run ${last}`) : ''].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="row-actions">
                    {c.state === 'running' && c.port
                      ? <button className="primary" onClick={() => run(() => host.openUrl(`http://localhost:${c.port}`))}>Open</button>
                      : <button className="primary" onClick={() => run(() => host.startApp(c.app))}>Start</button>}
                    {c.state === 'running' && <button onClick={() => run(() => host.stopApp(c.app.id))}>Stop</button>}
                    <button onClick={() => onView('localhost')}>Details</button>
                  </div>
                </div>
              );
            })}
            {runningList.length > RUN_ROWS && <button className="link more-link" onClick={() => onView('localhost')}>+{runningList.length - RUN_ROWS} more running</button>}
          </>
        ) : (
          <div className="run-row">
            <div className="row-main wrap">
              <h2>Welcome to PortPilot</h2>
              <span className="tile-sub">Add a project folder. PortPilot finds the start command and a free port, and you press Start.</span>
            </div>
            <div className="row-actions"><button className="primary" onClick={() => onView('library')}>Add an app</button></div>
          </div>
        )}
      </div>

      <div className="tile h-browsers">
        <div className="tile-head">
          <button className="link" onClick={() => onView('browsers')}>Browsers</button>
          <span className="tile-sub">{num(t.profilesUp, 'profilesUp')} open of {num(t.profiles, 'profiles')}</span>
        </div>
        <div className="mini">
          {profiles.map((p) => (
            <button key={p.name} className="th-wrap" onClick={() => onView('browsers')}>
              <span className={`th${art.byName[p.name] ? ' art' : ''}${p.state === 'up' ? ' sel' : ''}`}
                style={art.byName[p.name] ? { backgroundImage: `url(${art.byName[p.name]}), ${gradient(p.name)}` } : { background: gradient(p.name) }} />
              <span className="cap">{p.name}</span>
            </button>
          ))}
          {profiles.length === 0 && <span className="tile-sub">No browser profiles yet</span>}
        </div>
      </div>

      {scene && (
      <div className="tile h-scene">
        <span className="tile-title">Scene</span>
          <>
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
          </>
      </div>
      )}

      {all.length > 0 && (
      <div className="tile h-recent">
        <span className="tile-title">Recently used</span>
        <div className="mini five">
          {strip.map((c) => (
            <div key={c.app.id} className="th-card">
              <button className="th-wrap" title={`Open ${c.app.name}`} onClick={() => openApp(c)}>
                <span className="th" style={thumbs.byApp[c.app.id] ? { backgroundImage: `url(${thumbs.byApp[c.app.id].url})` } : { background: gradient(c.app.name) }} />
                <span className="cap">{c.app.name}</span>
              </button>
              {c.state !== 'running' && <button className="th-start" aria-label={`Start ${c.app.name}`} onClick={() => run(() => host.startApp(c.app))}>Start</button>}
            </div>
          ))}
          {strip.length === 0 && <span className="tile-sub">Apps you run will show up here</span>}
        </div>
      </div>
      )}
    </section>
  );
}
