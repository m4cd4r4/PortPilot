import { MORE_VIEWS, VIEWS, type View } from '../model';

interface Props { view: View; onView: (v: View) => void; onSearch: () => void }

const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  localhost: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  browsers: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  ports: 'M4 9h14l-4-4M20 15H6l4 4',
  scenes: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  history: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
};

function Icon({ name }: { name: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
  );
}

const MARK = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    <path d="M12 5.5l3.2 8.3L12 12.3 8.8 13.8z" fill="currentColor" />
    <circle cx="12" cy="17.2" r="1.3" fill="currentColor" />
  </svg>
);

/** The Ledger navigation: every section in one column. Tab buttons carry only their label as text. */
export function Sidebar({ view, onView, onSearch }: Props) {
  const item = (v: { view: View; label: string }) => (
    <button key={v.view} role="tab" aria-selected={view === v.view} className={view === v.view ? 'on' : ''}
      onClick={() => onView(v.view)}><Icon name={v.view} />{v.label}</button>
  );
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="brand"><span className="mark">{MARK}</span>PortPilot</div>
      <button className="search" onClick={onSearch} aria-label="Search and run commands">
        <span>Search or jump</span><kbd>Ctrl K</kbd>
      </button>
      <nav className="snav" role="tablist" aria-label="Section" aria-orientation="vertical">
        {[...VIEWS, ...MORE_VIEWS].map(item)}
      </nav>
      <div className="sfoot">
        <nav className="snav" role="tablist" aria-label="Settings">{item({ view: 'settings', label: 'Settings' })}</nav>
      </div>
    </aside>
  );
}
