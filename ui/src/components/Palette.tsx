import { useMemo, useRef, useState } from 'react';
import type { Host, Snapshot } from '../host';
import { VIEWS, type View } from '../model';
import { palette, type Command } from '../palette';

interface Props {
  open: boolean; onClose: () => void; host: Host; snap: Snapshot;
  view: View; onView: (v: View) => void; onDone: () => void;
}

/** Mounted only while open, so every open starts with fresh state and an input focused by autoFocus. */
export function Palette(props: Props) {
  return props.open ? <PaletteBody {...props} /> : null;
}

function PaletteBody({ open, onClose, host, snap, view, onView, onDone }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [armed, setArmed] = useState('');
  const [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!open) return [];
    const p = palette();
    const cmds = p.buildCommands({
      apps: snap.apps.filter((a) => !a.parentId), running: snap.running, ports: snap.ports, profiles: snap.profiles,
      views: [...VIEWS, { view: 'history', label: 'History' }].map((v) => ({ view: v.view, label: `Go to ${v.label}` })),
      view,
    });
    return p.rank(query, cmds);
  }, [open, query, snap, view]);

  const run = async (cmd: Command) => {
    if (cmd.confirm && armed !== cmd.id) { setArmed(cmd.id); setStatus(cmd.confirm); return; }
    const a = cmd.action;
    try {
      if (a.type === 'view') onView(a.view as View);
      else if (a.type === 'startApp') await host.startApp(snap.apps.find((x) => x.id === a.id)!);
      else if (a.type === 'stopApp') await host.stopApp(a.id!);
      else if (a.type === 'openApp') {
        const port = snap.running[a.id!]?.port ?? snap.apps.find((x) => x.id === a.id)?.preferredPort;
        if (port) await host.openUrl(`http://localhost:${port}`);
      } else if (a.type === 'startBrowser') await host.startBrowser(a.name!);
      else if (a.type === 'stopBrowser') await host.stopBrowser(a.name!);
      else if (a.type === 'killPort') await host.killPort(a.port!);
      else if (a.type === 'scan') { /* the refresh below is the scan */ }
      else { setStatus('That command arrives in a later wave'); return; }
      onClose();
      onDone();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const p = palette();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(p.moveIndex(index, results.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(p.moveIndex(index, results.length, -1)); }
    else if (e.key === 'Enter' && results[index]) { e.preventDefault(); run(results[index]); }
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input ref={input} autoFocus value={query} placeholder="Type a command, app, port or profile"
          role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={results[index] ? `pal-${results[index].id}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); setArmed(''); setStatus(''); }}
          onKeyDown={onKeyDown} />
        <ul id="palette-list" role="listbox">
          {results.map((c, i) => (
            <li key={c.id} id={`pal-${c.id}`} role="option" aria-selected={i === index}
              className={i === index ? 'on' : ''} onMouseMove={() => setIndex(i)} onClick={() => run(c)}>
              <span className="lbl">{c.label}</span><span className="hint">{c.hint}</span>
            </li>
          ))}
          {!results.length && <li className="empty">No matching command</li>}
        </ul>
        {status && <p className="pal-status" role="status">{status}</p>}
      </div>
    </div>
  );
}
