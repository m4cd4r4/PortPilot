import { useMemo, useState } from 'react';
import type { AppRec, Host, Snapshot } from '../host';
import { groupOf } from '../model';
import { AppDrawer } from './AppDrawer';
import { AppInspector } from './AppInspector';

interface Props { host: Host; snap: Snapshot; onDone: () => void }

export function Library({ host, snap, onDone }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AppRec | 'new' | null>(null);
  const [inspect, setInspect] = useState<AppRec | null>(null);
  const [error, setError] = useState('');
  const [groupName, setGroupName] = useState('');
  const [showGroups, setShowGroups] = useState(false);

  const list = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return snap.apps
      .filter((a) => !a.parentId)
      .filter((a) => {
        const hay = `${a.name} ${a.command || ''} ${a.cwd || ''} ${a.preferredPort || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => Number(!!b.isFavorite) - Number(!!a.isFavorite) || a.name.localeCompare(b.name));
  }, [snap.apps, query]);

  const act = async (fn: () => Promise<unknown>) => {
    try { setError(''); await fn(); onDone(); } catch (e) { setError((e as Error).message); }
  };
  const groupName_ = (a: AppRec) => snap.groups.find((g) => g.id === groupOf(a))?.name;
  const close = () => setEditing(null);
  const finish = () => { setEditing(null); onDone(); };

  return (
    <section className="library-view" aria-label="Library">
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter apps" aria-label="Filter apps" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="toolbar-end">
          <button onClick={() => setShowGroups((s) => !s)} aria-expanded={showGroups}>Groups</button>
          <button className="primary" onClick={() => setEditing('new')}>Add app</button>
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}

      {showGroups && (
        <div className="groups-panel" role="region" aria-label="Groups">
          {snap.groups.map((g) => (
            <GroupRow key={g.id} name={g.name} count={snap.apps.filter((a) => groupOf(a) === g.id).length}
              onRename={(n) => act(() => host.saveGroup({ id: g.id, name: n }))}
              onDelete={() => act(() => host.deleteGroup(g.id))} />
          ))}
          <form className="inline-row" onSubmit={(e) => { e.preventDefault(); const n = groupName.trim(); if (n) act(async () => { await host.saveGroup({ name: n }); setGroupName(''); }); }}>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="New group name" aria-label="New group name" maxLength={40} />
            <button type="submit" disabled={!groupName.trim()}>Add group</button>
          </form>
        </div>
      )}

      {!snap.apps.length
        ? <div className="empty-note"><p>No apps yet. Add one, or start a dev server and PortPilot will notice it.</p><button className="primary" onClick={() => setEditing('new')}>Add app</button></div>
        : !list.length
          ? <p className="empty-note">No app matches that filter.</p>
          : (
            <table className="ports library">
              <thead><tr><th>App</th><th>Port</th><th>Group</th><th>Command</th><th /></tr></thead>
              <tbody>
                {list.map((a) => {
                  const live = snap.running[a.id];
                  const state = live ? 'running' : snap.crashed[a.id] ? 'crashed' : 'stopped';
                  return (
                    <tr key={a.id} data-app={a.id}>
                      <td><span className="title"><span className={`dot ${state}`} aria-hidden="true" /><span className="name">{a.name}</span>
                        {a.isFavorite && <span className="chip">starred</span>}</span></td>
                      <td className="mono">{live?.port ?? a.preferredPort ? `:${live?.port ?? a.preferredPort}` : ''}</td>
                      <td>{groupName_(a) || <span className="muted">none</span>}</td>
                      <td className="mono cmd" title={a.command}>{a.command}</td>
                      <td className="row-acts">
                        <button aria-pressed={!!a.isFavorite} onClick={() => act(() => host.toggleFavorite(a.id))}>{a.isFavorite ? 'Unstar' : 'Star'}</button>
                        {live ? <button onClick={() => act(() => host.stopApp(a.id))}>Stop</button> : <button onClick={() => act(() => host.startApp(a))}>Start</button>}
                        <button onClick={() => setInspect(a)}>Details</button>
                        <button onClick={() => setEditing(a)}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

      {editing && <AppDrawer host={host} app={editing === 'new' ? null : editing} groups={snap.groups} onClose={close} onDone={finish} />}
      {inspect && <AppInspector host={host} app={inspect} port={snap.running[inspect.id]?.port} running={!!snap.running[inspect.id]}
        crashed={!!snap.crashed[inspect.id]} onClose={() => setInspect(null)} />}
    </section>
  );
}

function GroupRow({ name, count, onRename, onDelete }: { name: string; count: number; onRename: (n: string) => void; onDelete: () => void }) {
  const [text, setText] = useState(name);
  const [armed, setArmed] = useState(false);
  const commit = () => { const n = text.trim(); if (n && n !== name) onRename(n); else setText(name); };
  return (
    <div className="inline-row group-row">
      <input value={text} aria-label={`Rename group ${name}`} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      <small>{count} {count === 1 ? 'app' : 'apps'}</small>
      {armed
        ? <><button className="danger" onClick={onDelete}>Delete group</button><button onClick={() => setArmed(false)}>Keep</button></>
        : <button onClick={() => setArmed(true)}>Delete</button>}
    </div>
  );
}
