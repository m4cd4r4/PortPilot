import { useMemo, useState } from 'react';
import type { Host, Snapshot } from '../host';

interface Props { host: Host; snap: Snapshot; onDone: () => void }

/** Port 0-1023 and a few system names are not something a dev server owns; killing them needs more than one click. */
const SYSTEM = /^(system|svchost|services|lsass|wininit|spoolsv|csrss)(\.exe)?$/i;

export function Ports({ host, snap, onDone }: Props) {
  const [query, setQuery] = useState('');
  const [armed, setArmed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [free, setFree] = useState<number | null>(null);

  const owner = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of snap.apps) {
      const live = snap.running[a.id];
      if (live?.port) m.set(live.port, a.name);
    }
    return m;
  }, [snap]);

  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...snap.ports]
      .filter((p) => {
        const hay = `${p.port} ${p.processName || ''} ${p.pid || ''} ${owner.get(p.port) || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => a.port - b.port);
  }, [snap.ports, query, owner]);

  const kill = async (port: number) => {
    setBusy(true);
    setError('');
    try { await host.killPort(port); setArmed(null); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const find = async () => {
    setError('');
    try { setFree(await host.findFreePort(3000, 9000)); } catch (e) { setError((e as Error).message); }
  };

  return (
    <section className="ports-view" aria-label="Ports">
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter by port, process or app" aria-label="Filter ports"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="toolbar-end">
          {free != null && <span className="saved" role="status">:{free} is free</span>}
          <button onClick={find}>Find a free port</button>
          <button onClick={onDone}>Rescan</button>
        </div>
      </div>

      {snap.conflicts.length > 0 && (
        <div className="conflicts" role="region" aria-label="Blocked apps">
          {snap.conflicts.map((c) => (
            <div className="conflict-row" key={`${c.appId}-${c.port}`}>
              <span><strong>{c.appName || 'An app'}</strong> is blocked: :{c.port} is held by {(c.occupiedBy?.processName || 'another process').replace(/\.exe$/i, '')}
                {c.occupiedBy?.pid ? ` (pid ${c.occupiedBy.pid})` : ''}</span>
              <button disabled={busy} onClick={() => kill(c.port)}>Free :{c.port}</button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="notice" role="alert">{error}</p>}
      {!rows.length
        ? <p className="empty-note">{snap.ports.length ? 'No port matches that filter.' : 'Nothing is listening on a port right now.'}</p>
        : (
          <table className="ports">
            <thead><tr><th>Port</th><th>Process</th><th>PID</th><th>PortPilot app</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const sys = p.port < 1024 || SYSTEM.test(p.processName || '');
                return (
                  <tr key={`${p.port}-${p.pid}`} data-port={p.port}>
                    <td className="mono">:{p.port}</td>
                    <td>{(p.processName || 'unknown').replace(/\.exe$/i, '')}</td>
                    <td className="mono">{p.pid ?? ''}</td>
                    <td>{owner.get(p.port) || <span className="muted">none</span>}</td>
                    <td className="row-acts">
                      <button onClick={() => host.openUrl(`http://localhost:${p.port}`)}>Open</button>
                      {armed === p.port
                        ? <><button className="danger" disabled={busy} onClick={() => kill(p.port)}>{sys ? 'Kill system process' : 'Confirm kill'}</button>
                          <button onClick={() => setArmed(null)}>Keep</button></>
                        : <button onClick={() => setArmed(p.port)}>Kill</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </section>
  );
}
