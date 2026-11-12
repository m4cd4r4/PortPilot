import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { every } from '../poll';
import type { BrowserSession, Host } from '../host';
import { browserView } from '../legacy';
import { dayOf, hueOf } from '../model';
import { IconButton } from './icons';

interface Props { host: Host; kindSwitch: ReactNode }

const matches = (e: BrowserSession, q: string) => !q || [e.profile, ...e.tabs.flatMap((t) => [t.title || '', t.url || ''])]
  .some((s) => s.toLowerCase().includes(q));

/** Past browser sessions, every profile, newest first: what was open, who started it, Open again. */
export function BrowserHistory({ host, kindSwitch }: Props) {
  const [list, setList] = useState<BrowserSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await host.browserHistory());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [host]);

  useEffect(() => {
    load();
    return every(load, 10000);
  }, [load]);

  const bv = browserView();
  const q = query.trim().toLowerCase();
  const days = useMemo(() => {
    const out: Array<{ day: string; list: BrowserSession[] }> = [];
    for (const e of list.filter((x) => matches(x, q))) {
      const day = dayOf(e.startedAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.list.push(e); else out.push({ day, list: [e] });
    }
    return out;
  }, [list, q]);

  const reopen = async (e: BrowserSession) => {
    setBusy(e.id);
    setError('');
    setDone('');
    try {
      setDone(bv.reopenText(await host.reopenBrowser(e.id)));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="history-view" aria-label="History">
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter by profile, tab or address" aria-label="Filter browser sessions" value={query} onChange={(e) => setQuery(e.target.value)} />
        {kindSwitch}
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      {done && <p className="tile-notice info" role="status"><span>{done}</span><button className="link" onClick={() => setDone('')} aria-label="Dismiss">Dismiss</button></p>}
      {loaded && !days.length && <p className="empty-note">{q ? 'No browser session matches that filter.' : 'No browser sessions yet. Start a profile on Browsers and it shows up here.'}</p>}
      {days.map((d) => (
        <section key={d.day} aria-label={d.day}>
          <h3 className="group-h">{d.day}<small>{d.list.length}</small></h3>
          <ul className="timeline cards rows">
            {d.list.map((e) => {
              const n = e.tabs.length;
              const { shown, more } = bv.shownTabs(e);
              const st = e.running ? 'running' : 'stopped';
              const ended = bv.endedWord(e);
              return (
                <li key={e.id} className="run card" data-session={e.id}>
                  <div className="shot small" style={{ background: `hsl(${hueOf(e.profile)} 26% 22%)` }}>
                    <span className="letter" aria-hidden="true">{e.profile.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <div className="meta">
                    <div className="title"><span className={`stat ${st}`}><span aria-hidden="true">{e.running ? '●' : '○'}</span> {e.running ? 'open' : 'ended'}</span><span className="name">{e.profile}</span></div>
                    <div className="sub">
                      <span className="when">{bv.sessionWhen(e)}</span>
                      <span>started by {bv.startedByWord(e.startedBy)}</span>
                      <span>{n} tab{n === 1 ? '' : 's'}</span>
                      {ended && <span>{ended}</span>}
                    </div>
                    {n > 0 && (
                      <div className="sub tabs-line" title={e.tabs.map((t) => t.url || t.title || '').join('\n')}>
                        <span className="note">{shown.map((t) => bv.tabLabel(t)).join(' · ')}{more ? ` · +${more} more` : ''}</span>
                      </div>
                    )}
                  </div>
                  <div className="acts shown">
                    <IconButton icon="again" label="Open again" tip={n ? `Start ${e.profile} and open these ${n} tab${n === 1 ? '' : 's'}` : 'No tabs were saved for this session'}
                      disabled={!n} busy={busy === e.id} onClick={() => reopen(e)} />
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
