import { useEffect, useRef, useState } from 'react';
import { VIEWS, type View } from '../model';

interface Props { view: View; onView: (v: View) => void; onSearch: () => void; onClassic: () => Promise<void> }

export function TopBar({ view, onView, onSearch, onClassic }: Props) {
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [menu]);

  const classic = async () => {
    try { setError(''); await onClassic(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <header className="topbar" role="banner">
      <div className="brand">PortPilot</div>
      <nav className="seg" role="tablist" aria-label="Section">
        {VIEWS.map((v) => (
          <button key={v.view} role="tab" aria-selected={view === v.view}
            className={view === v.view ? 'on' : ''} onClick={() => onView(v.view)}>{v.label}</button>
        ))}
      </nav>
      <button className="search" onClick={onSearch} aria-label="Search and run commands">
        <span>Search apps, ports, profiles</span><kbd>Ctrl K</kbd>
      </button>
      <div className="actions" ref={box}>
        <button className={`icon${view === 'history' ? ' on' : ''}`} title="History" aria-label="History" aria-pressed={view === 'history'} onClick={() => onView(view === 'history' ? 'home' : 'history')}>History</button>
        <button className={`icon${menu || view === 'settings' ? ' on' : ''}`} title="Settings and views" aria-label="Settings" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Settings</button>
        {menu && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => { setMenu(false); onView('settings'); }}>Settings</button>
            <button role="menuitem" onClick={classic}>Switch to classic view</button>
            <p>The web portal is still on the classic view.</p>
            {error && <p className="notice" role="alert">{error}</p>}
          </div>
        )}
      </div>
    </header>
  );
}
