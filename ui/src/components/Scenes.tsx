import { useEffect, useState } from 'react';
import type { Host, Scene, Snapshot } from '../host';
import { captureRunning, sceneRun, sceneSummary, startScene, stopScene, type SceneReport } from '../scenes';
import { SceneDrawer } from './SceneDrawer';

interface Props { host: Host; snap: Snapshot; onDone: () => void }

export function Scenes({ host, snap, onDone }: Props) {
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [editing, setEditing] = useState<Scene | 'new' | null>(null);
  const [draft, setDraft] = useState<{ apps: string[]; browsers: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [reports, setReports] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');

  const load = () => host.scenes().then(setScenes).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, [host]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string) => snap.apps.find((a) => a.id === id)?.name || id;
  const lines = (r: SceneReport) => [
    ...(r.started.length ? [`Started: ${r.started.join(', ')}`] : []),
    ...(r.already.length ? [`Already running: ${r.already.join(', ')}`] : []),
    ...r.failed.map((f) => `Blocked: ${f.name} (${f.reason})`),
  ];

  const start = async (s: Scene) => {
    setBusy(s.id); setError('');
    try {
      const r = await startScene(host, s);
      setReports((m) => ({ ...m, [s.id]: lines(r) }));
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const stop = async (s: Scene) => {
    setBusy(s.id); setError('');
    try {
      const stopped = await stopScene(host, s);
      setReports((m) => ({ ...m, [s.id]: [stopped.length ? `Stopped: ${stopped.join(', ')}` : 'Nothing to stop: this scene started nothing that is still running.'] }));
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  const live = captureRunning(snap);
  const canCapture = live.apps.length + live.browsers.length > 0;
  const finish = () => { setEditing(null); setDraft(null); load(); onDone(); };

  return (
    <section className="library-view scenes-view" aria-label="Scenes">
      <div className="toolbar">
        <p className="set-note">A scene starts a set of apps and browser profiles together. Stop only stops what the scene started.</p>
        <div className="toolbar-end">
          <button disabled={!canCapture} title={canCapture ? '' : 'Nothing is running to save'}
            onClick={() => { setDraft(live); setEditing('new'); }}>Save what is running</button>
          <button className="primary" onClick={() => { setDraft(null); setEditing('new'); }}>New scene</button>
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}

      {scenes && !scenes.length && <p className="empty-note">No scenes yet. Start the apps and browsers you work with, then press Save what is running.</p>}
      <div className="scene-list">
        {(scenes || []).map((s) => {
          const run = sceneRun(s.id);
          const up = s.apps.filter((id) => snap.running[id]).length + s.browsers.filter((n) => snap.profiles.find((p) => p.name === n)?.state === 'up').length;
          return (
            <article className="scene" key={s.id} data-scene={s.id}>
              <header>
                <h3>{s.name}</h3>
                <span className="muted">{sceneSummary(s)}, {up} up</span>
                <span className="spacer" />
                <button className="primary" disabled={busy === s.id} onClick={() => start(s)}>{busy === s.id ? 'Working' : 'Start'}</button>
                <button disabled={busy === s.id || !run} title={run ? '' : 'This scene has not started anything'} onClick={() => stop(s)}>Stop</button>
                <button onClick={() => { setDraft(null); setEditing(s); }}>Edit</button>
              </header>
              <div className="chips">
                {s.apps.map((id) => <span className="chip" key={id}>{nameOf(id)}</span>)}
                {s.browsers.map((n) => <span className="chip browser" key={n}>{n}</span>)}
              </div>
              {reports[s.id] && <ul className="scene-report" role="status">{reports[s.id].map((l, i) => <li key={i} className={l.startsWith('Blocked') ? 'bad' : ''}>{l}</li>)}</ul>}
            </article>
          );
        })}
      </div>

      {editing && <SceneDrawer host={host} snap={snap} scene={editing === 'new' ? null : editing} seed={draft}
        onClose={() => { setEditing(null); setDraft(null); }} onDone={finish} />}
    </section>
  );
}
