import { VIEWS, type View } from '../model';

interface Props { view: View; onView: (v: View) => void; onSearch: () => void }

export function TopBar({ view, onView, onSearch }: Props) {
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
      <div className="actions">
        <button className={`icon${view === 'history' ? ' on' : ''}`} title="History" aria-label="History" aria-pressed={view === 'history'} onClick={() => onView(view === 'history' ? 'home' : 'history')}>History</button>
        <button className="icon" title="Settings (Wave 4)" aria-label="Settings" disabled>Settings</button>
      </div>
    </header>
  );
}
