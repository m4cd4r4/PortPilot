import { useMemo, useState } from 'react';
import type { Host, Snapshot } from '../host';
import { IconButton } from './icons';
import '../legacy'; // loads src/core/status.js, which portsModel reads
import { splitPorts, type PortRow } from '../portsModel';

interface Props { host: Host; snap: Snapshot; onDone: () => void; /** The port a taken-port notice sent the user here for. */ filter?: string }

export function Ports({ host, snap, onDone, filter = '' }: Props) {
  const [query, setQuery] = useState(filter);
  const [armed, setArmed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [free, setFree] = useState<number | null>(null);
  /** System ports are folded away until asked for; a filter shows its matches wherever they are. */
  const [showSystem, setShowSystem] = useState(false);
  const [showTemp, setShowTemp] = useState(false);

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
    const match = snap.ports.filter((p) => {
      const hay = `${p.port} ${p.processName || ''} ${p.pid || ''} ${owner.get(p.port) || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return splitPorts(match, new Set(owner.keys()));
  }, [snap.ports, query, owner]);
  const filtering = query.trim() !== '';
  const total = rows.mine.length + rows.temp.length + rows.system.length;

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

      {error && <p className="notice" role="alert">{error}</p>}
      {!total
        ? <p className="empty-note">{snap.ports.length ? 'No port matches that filter.' : 'Nothing is listening on a port right now.'}</p>
        : (
          <table className="ports">
            <thead><tr><th>Port</th><th>Process</th><th>PID</th><th>PortPilot app</th><th /></tr></thead>
            <tbody>
              {rows.mine.map((p) => row(p, ''))}
              {!filtering && rows.temp.length > 0 && (
                <tr className="ports-fold fold-temp">
                  <td colSpan={5}>
                    <button className="link" aria-expanded={showTemp} onClick={() => setShowTemp((v) => !v)}>{showTemp ? 'Hide' : 'Show'} {rows.temp.length} temporary {rows.temp.length === 1 ? 'port' : 'ports'}</button>
                    <span className="muted"> 49152 and above, opened by a program for its own use; no PortPilot app runs on them.</span>
                  </td>
                </tr>
              )}
              {(filtering || showTemp) && rows.temp.map((p) => row(p, 'tmp'))}
              {!filtering && rows.system.length > 0 && (
                <tr className="ports-fold fold-sys">
                  <td colSpan={5}>
                    <button className="link" aria-expanded={showSystem} onClick={() => setShowSystem((v) => !v)}>{showSystem ? 'Hide' : 'Show'} {rows.system.length} system {rows.system.length === 1 ? 'port' : 'ports'}</button>
                    <span className="muted"> Held by the operating system or under 1024; not something a dev server owns.</span>
                  </td>
                </tr>
              )}
              {(filtering || showSystem) && rows.system.map((p) => row(p, 'sys'))}
            </tbody>
          </table>
        )}
    </section>
  );

  function row(p: PortRow, kind: '' | 'tmp' | 'sys') {
                const sys = kind === 'sys';
                return (
                  <tr key={`${p.port}-${p.pid}`} data-port={p.port} className={kind || undefined}>
                    <td className="mono">:{p.port}</td>
                    <td>{(p.processName || 'unknown').replace(/\.exe$/i, '')}</td>
                    <td className="mono">{p.pid ?? ''}</td>
                    <td>{owner.get(p.port) ? <span className="stat running"><span aria-hidden="true">●</span> {owner.get(p.port)}</span> : <span className="muted">none</span>}</td>
                    <td className="row-acts">
                      <IconButton icon="open" label="Open" tip={`Open localhost:${p.port}`} onClick={() => host.openUrl(`http://localhost:${p.port}`)} />
                      {armed === p.port
                        ? <><button className="danger" disabled={busy} onClick={() => kill(p.port)}>{sys ? 'Kill system process' : 'Confirm kill'}</button>
                          <button onClick={() => setArmed(null)}>Keep</button></>
                        : <IconButton icon="kill" label="Kill" tip={`Kill what holds :${p.port}`} onClick={() => setArmed(p.port)} />}
                    </td>
                  </tr>
                );
  }
}
