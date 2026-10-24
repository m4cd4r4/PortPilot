import { useEffect, useRef, useState } from 'react';
import type { AppRec, Group, Host } from '../host';

interface Props {
  host: Host;
  /** null = adding a new app */
  app: AppRec | null;
  groups: Group[];
  onClose: () => void;
  onDone: () => void;
}

export function AppDrawer({ host, app, groups, onClose, onDone }: Props) {
  const adding = !app;
  const [name, setName] = useState(app?.name || '');
  const [command, setCommand] = useState(app?.command || '');
  const [cwd, setCwd] = useState(app?.cwd || '');
  const [port, setPort] = useState(app?.preferredPort ? String(app.preferredPort) : '');
  const [group, setGroup] = useState(app?.group || app?.groupId || '');
  const [description, setDescription] = useState(app?.description || '');
  const [healthPath, setHealthPath] = useState(app?.healthPath || '');
  const [autoStart, setAutoStart] = useState(!!app?.autoStart);
  const [reservePort, setReservePort] = useState(!!app?.reservePort);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setWorking(true);
    setError('');
    setNote('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  };

  const browse = () => run(async () => {
    const dir = await host.browseDirectory();
    if (!dir) return;
    setCwd(dir);
    const found = await host.detectProject(dir);
    if (!found) { setNote('Folder chosen. No project type recognised, so fill in the command yourself.'); return; }
    if (!name.trim() && found.name) setName(found.name);
    if (!command.trim() && found.command) setCommand(found.command);
    const p = found.preferredPort ?? found.port;
    if (!port && p) setPort(String(p));
    setNote('Filled in from the folder. Check the command before saving.');
  });

  const pickFree = () => run(async () => { setPort(String(await host.findFreePort(3000, 9000))); });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const n = port.trim() ? Number(port) : null;
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 65535)) throw new Error('Port must be a whole number from 1 to 65535.');
      await host.saveApp({
        ...(app ? { id: app.id } : {}),
        name: name.trim(), command: command.trim(), cwd: cwd.trim(), preferredPort: n,
        group: group || null, description: description.trim() || null, healthPath: healthPath.trim() || null,
        autoStart, reservePort,
      });
      onDone();
    });
  };

  const doDelete = () => run(async () => { await host.deleteApp(app!.id); onDone(); });

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="drawer" role="dialog" aria-modal="true" aria-label={adding ? 'Add app' : `Edit ${app!.name}`} onSubmit={save}>
        <header className="drawer-head">
          <h2>{adding ? 'Add app' : app!.name}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">Close</button>
        </header>

        <div className="drawer-body">
          <label>Project folder
            <span className="inline-row">
              <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="I:/Scratch/my-app" />
              <button type="button" disabled={working} onClick={browse}>Browse</button>
            </span>
            <small>Browsing reads the folder and fills in the name, command and port when it recognises the project.</small>
          </label>
          <label>Name
            <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="My app" required maxLength={80} />
          </label>
          <label>Start command
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm run dev" required />
          </label>
          <div className="row2 two">
            <label>Port
              <span className="inline-row">
                <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" placeholder="3000" />
                <button type="button" disabled={working} onClick={pickFree}>Free</button>
              </span>
            </label>
            <label>Group
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          </div>
          <label>Health path
            <input value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/api/health" />
            <small>Optional. A 2xx or 3xx answer here counts as healthy.</small>
          </label>
          <label>Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} />
          </label>
          <label className="check"><input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} /> Start when PortPilot opens</label>
          <label className="check"><input type="checkbox" checked={reservePort} onChange={(e) => setReservePort(e.target.checked)} /> Keep this port reserved while the app is stopped</label>

          {note && <p className="set-note" role="status">{note}</p>}
          {error && <p className="notice" role="alert">{error}</p>}
        </div>

        <footer className="drawer-foot">
          {app && (
            confirmDelete
              ? <span className="danger-row">Delete from PortPilot? The project folder is untouched.
                <button type="button" className="danger" disabled={working} onClick={doDelete}>Yes, delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)}>Keep</button></span>
              : <button type="button" className="danger-ghost" onClick={() => setConfirmDelete(true)}>Delete app</button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={working}>{working ? 'Saving' : adding ? 'Add' : 'Save'}</button>
        </footer>
      </form>
    </div>
  );
}
