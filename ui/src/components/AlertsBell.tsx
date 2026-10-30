import { useEffect, useRef, useState } from 'react';

interface Props { warnings: string[]; onFix: () => void; where: 'side' | 'top' }

/** Blocked ports live behind a bell with a count, not a banner over every screen. Fix opens Ports. */
export function AlertsBell({ warnings, onFix, where }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const n = warnings.length;

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { if (n === 0) setOpen(false); }, [n]);

  const label = n === 0 ? 'Alerts, none' : `Alerts, ${n}`;
  return (
    <div className={`alerts alerts-${where}`} ref={box}>
      <button className={`bell${n ? ' has' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label}
        onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
        </svg>
        {where === 'side' && <span className="bell-label">Alerts</span>}
        {n > 0 && <span className="bell-count" aria-hidden="true">{n}</span>}
      </button>
      {open && (
        <div className="alerts-pop" role="dialog" aria-label="Alerts">
          {n === 0 ? <p className="alerts-none">Nothing needs you.</p> : (
            <ul>
              {warnings.map((w, i) => (
                <li key={i}><span className="dot warn" aria-hidden="true" /><span className="msg">{w}</span>
                  <button onClick={() => { setOpen(false); onFix(); }}>Fix</button></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
