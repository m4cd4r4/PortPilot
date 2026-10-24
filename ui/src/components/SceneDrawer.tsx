import { useEffect, useRef, useState } from 'react';
import type { Host, Scene, Snapshot } from '../host';

interface Props {
  host: Host; snap: Snapshot;
  /** null = a new scene */
  scene: Scene | null;
  /** Members to tick for a new scene (from "Save what is running") */
  seed: { apps: string[]; browsers: string[] } | null;
  onClose: () => void; onDone: () => void;
}

export function SceneDrawer({ host, snap, scene, seed, onClose, onDone }: Props) {
  const [name, setName] = useState(scene?.name || '');
  const [apps, setApps] = useState<Set<string>>(new Set(scene?.apps || seed?.apps || []));
  const [browsers, setBrowsers] = useState<Set<string>>(new Set(scene?.browsers || seed?.browsers || []));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flip = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };
  const run = async (fn: () => Promise<void>) => {
    setWorking(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => { await host.saveScene({ ...(scene ? { id: scene.id } : {}), name, apps: [...apps], browsers: [...browsers] }); onDone(); });
  };

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const appRows = snap.apps.filter((a) => !a.parentId && (apps.has(a.id) || match(a.name)));
  const profileRows = snap.profiles.filter((p) => browsers.has(p.name) || match(p.name));

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="drawer" role="dialog" aria-modal="true" aria-label={scene ? `Edit ${scene.name}` : 'New scene'} onSubmit={save}>
        <header className="drawer-head">
          <h2>{scene ? scene.name : 'New scene'}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="drawer-body">
          <label>Name
            <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning work" required maxLength={60} />
          </label>
          <label>Find members
            <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter apps and profiles" />
          </label>
          <fieldset className="members">
            <legend>Apps ({apps.size})</legend>
            {appRows.map((a) => (
              <label className="check" key={a.id}><input type="checkbox" checked={apps.has(a.id)} onChange={() => flip(apps, setApps, a.id)} /> {a.name}</label>
            ))}
            {!appRows.length && <small>No app matches.</small>}
          </fieldset>
          <fieldset className="members">
            <legend>Browser profiles ({browsers.size})</legend>
            {profileRows.map((p) => (
              <label className="check" key={p.name}><input type="checkbox" checked={browsers.has(p.name)} onChange={() => flip(browsers, setBrowsers, p.name)} /> {p.name}</label>
            ))}
            {!profileRows.length && <small>No profile matches.</small>}
          </fieldset>
          {error && <p className="notice" role="alert">{error}</p>}
        </div>
        <footer className="drawer-foot">
          {scene && (confirmDelete
            ? <span className="danger-row">Delete this scene? Apps and profiles stay.
              <button type="button" className="danger" disabled={working} onClick={() => run(async () => { await host.deleteScene(scene.id); onDone(); })}>Yes, delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Keep</button></span>
            : <button type="button" className="danger-ghost" onClick={() => setConfirmDelete(true)}>Delete scene</button>)}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={working}>{working ? 'Saving' : scene ? 'Save' : 'Create'}</button>
        </footer>
      </form>
    </div>
  );
}
