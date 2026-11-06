import { useEffect, useRef, useState } from 'react';
import { MORE_VIEWS, VIEWS, type Alert, type View } from '../model';

import { AlertsBell, type AlertAct } from './AlertsBell';
import { MARK } from './Sidebar';
import { IconButton } from './icons';

interface Props { view: View; onView: (v: View) => void; onSearch: () => void; alerts: Alert[]; onAlert: (a: Alert, act: AlertAct) => void }

export function TopBar({ view, onView, onSearch, alerts, onAlert }: Props) {
  const [more, setMore] = useState(false);
  const moreBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!more) return;
    const close = (e: Event) => { if (!moreBox.current?.contains(e.target as Node)) setMore(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [more]);

  return (
    <header className="topbar" role="banner">
      <div className="brand" role="img" aria-label="PortPilot" title="PortPilot"><span className="mark">{MARK}</span></div>
      <nav className="seg" role="tablist" aria-label="Section">
        {VIEWS.map((v) => (
          <button key={v.view} role="tab" aria-selected={view === v.view}
            className={view === v.view ? 'on' : ''} onClick={() => onView(v.view)}>{v.label}</button>
        ))}
        <div className="more" ref={moreBox}>
          <button aria-haspopup="menu" aria-expanded={more} className={MORE_VIEWS.some((v) => v.view === view) ? 'on' : ''}
            onClick={() => setMore((m) => !m)}>More ▾</button>
          {more && (
            <div className="menu more-menu" role="menu">
              {MORE_VIEWS.map((v) => (
                <button key={v.view} role="menuitem" className={view === v.view ? 'on' : ''}
                  onClick={() => { setMore(false); onView(v.view); }}>{v.label}</button>
              ))}
            </div>
          )}
        </div>
      </nav>
      <button className="search" onClick={onSearch} aria-label="Search and run commands">
        <span>Search apps, ports, profiles</span><kbd>Ctrl K</kbd>
      </button>
      <div className="actions">
        <AlertsBell alerts={alerts} where="top" onAct={onAlert} />
        <IconButton icon="settings" label="Settings" className={view === 'settings' ? 'on' : ''} aria-pressed={view === 'settings'}
          onClick={() => { setMore(false); onView('settings'); }} />
      </div>
    </header>
  );
}
