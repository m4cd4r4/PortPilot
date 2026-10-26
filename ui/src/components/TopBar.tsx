import { useEffect, useRef, useState } from 'react';
import { MORE_VIEWS, VIEWS, type View } from '../model';

interface Props { view: View; onView: (v: View) => void; onSearch: () => void; onClassic: () => Promise<void> }

export function TopBar({ view, onView, onSearch, onClassic }: Props) {
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const moreBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu && !more) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node) && !moreBox.current?.contains(e.target as Node)) { setMenu(false); setMore(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setMore(false); } };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [menu, more]);

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
        <div className="more" ref={moreBox}>
          <button aria-haspopup="menu" aria-expanded={more} className={MORE_VIEWS.some((v) => v.view === view) ? 'on' : ''}
            onClick={() => { setMenu(false); setMore((m) => !m); }}>More ▾</button>
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
      <div className="actions" ref={box}>
        <button className={`icon${menu || view === 'settings' ? ' on' : ''}`} title="Settings and views" aria-label="Settings" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMore(false); setMenu((m) => !m); }}>Settings</button>
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
