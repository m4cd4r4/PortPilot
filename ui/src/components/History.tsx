import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryData, Host, Run } from '../host';
import { runView } from '../legacy';

interface Props { host: Host }

const GLYPH = { running: '●', crashed: '✕', stopped: '○' } as const;
const WORD = { running: 'running', crashed: 'crashed', stopped: 'ended' } as const;
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown date' : DAY.format(d);
};

export function History({ host }: Props) {
  const [data, setData] = useState<HistoryData>({ runs: [], live: [], startable: [] });
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [shots, setShots] = useState<Record<string, string>>({});
  const seen = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      setData(await host.history());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [host]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const rv = runView();
  const runs = useMemo(() => rv.filterRuns(data.runs, { query }).slice(0, 200), [rv, data.runs, query]);

  // Fetch thumbnails for the runs on screen, once each.
  useEffect(() => {
    const want = runs.filter((r) => r.page?.thumb && !seen.current.has(r.id)).map((r) => r.id);
    if (!want.length) return;
    want.forEach((id) => seen.current.add(id));
    (async () => {
      for (let i = 0; i < want.length; i += 40) {
        try {
          const got = await host.thumbs(want.slice(i, i + 40));
          setShots((s) => ({ ...s, ...got }));
        } catch { /* a run without pixels shows the letter tile */ }
      }
    })();
  }, [runs, host]);

  const days = useMemo(() => {
    const out: Array<{ day: string; runs: Run[] }> = [];
    for (const r of runs) {
      const day = dayOf(r.startedAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.runs.push(r); else out.push({ day, runs: [r] });
    }
    return out;
  }, [runs]);

  const startAgain = async (r: Run) => {
    setBusy(r.id);
    try {
      setError('');
      const url = await host.startAgain(r.id);
      if (url) await host.openUrl(url);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="history-view" aria-label="History">
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter runs by app, branch, page or commit" aria-label="Filter runs" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      {loaded && !days.length && <p className="empty-note">{query ? 'No run matches that filter.' : 'No runs yet. Start an app and it shows up here.'}</p>}
      {days.map((d) => (
        <section key={d.day} aria-label={d.day}>
          <h3 className="group-h">{d.day}<small>{d.runs.length}</small></h3>
          <ul className="timeline cards rows">
            {d.runs.map((r) => {
              const live = data.live.includes(r.id);
              const state = rv.runStateOf(r, live);
              const canRestart = !live && data.startable.includes(r.id);
              const url = shots[r.id];
              const st = live ? 'running' : state.state === 'crashed' ? 'crashed' : 'stopped';
              return (
                <li key={r.id} className="run card" data-run={r.id}>
                  <div className="shot small">{url ? <img src={url} alt="" loading="lazy" /> : <span className="letter" aria-hidden="true">{rv.labelOf(r).slice(0, 1).toUpperCase()}</span>}</div>
                  <div className="meta">
                    <div className="title"><span className={`stat ${st}`}><span aria-hidden="true">{GLYPH[st]}</span> {WORD[st]}</span><span className="name">{rv.labelOf(r)}</span>
                      {r.git?.branch && <span className="branch">{r.git.branch}</span>}</div>
                    <div className="sub">{!live && <span>{state.text}</span>}{r.port && <span>:{r.port}</span>}<span>{rv.formatWhen(r)}</span></div>
                    {r.page?.title && <div className="sub"><span className="note">{r.page.title}</span></div>}
                  </div>
                  <div className="acts shown">
                    {live && r.port && <button onClick={() => host.openUrl(`http://localhost:${r.port}`)}>Open</button>}
                    {canRestart && <button disabled={busy === r.id} onClick={() => startAgain(r)}>{busy === r.id ? 'Starting' : 'Start again'}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
