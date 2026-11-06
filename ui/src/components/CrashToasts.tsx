import { useEffect, useState } from 'react';
import type { CrashAlert, Host } from '../host';

interface Props { host: Host; onRestart: (appId: string) => Promise<void>; onLogs: (appId: string) => void }

/**
 * The crash toast: `<app> crashed`, `:port · exit N`, the last output lines, Restart / Logs / Dismiss.
 * Sticky until one of those is pressed. Dismiss only closes the toast: the card and the
 * alerts bell keep the crash until the app starts again or it is dismissed from the bell.
 */
export function CrashToasts({ host, onRestart, onLogs }: Props) {
  const [list, setList] = useState<CrashAlert[]>([]);
  const [busy, setBusy] = useState('');
  /** appId -> why Restart failed, shown on that toast. */
  const [failed, setFailed] = useState<Record<string, string>>({});
  // A newer crash of the same app replaces its toast. The bell keeps every crash, so a 4th app's toast pushes out the oldest.
  useEffect(() => host.onCrash((a) => setList((l) => [...l.filter((x) => x.appId !== a.appId), a].slice(-3))), [host]);

  const close = (id: string) => setList((l) => l.filter((x) => x.appId !== id));
  const restart = async (id: string) => {
    setBusy(id);
    setFailed(({ [id]: _, ...rest }) => rest);
    try { await onRestart(id); close(id); }
    catch (e) { setFailed((f) => ({ ...f, [id]: (e as Error).message || 'Restart failed' })); }
    finally { setBusy(''); }
  };

  if (!list.length) return null;
  return (
    <div className="toasts">
      {list.map((a) => (
        <div key={a.appId} className="toast crash" role="alert" aria-label={a.title} data-app={a.appId}>
          <p className="toast-title"><span className="dot warn" aria-hidden="true" />{a.title}</p>
          {a.meta && <p className="toast-meta">{a.meta}</p>}
          {a.lines.length > 0 && <pre className="toast-lines">{a.lines.join('\n')}</pre>}
          {failed[a.appId] && <p className="toast-meta notice">Restart failed: {failed[a.appId]}</p>}
          <div className="toast-actions">
            <button className="primary" disabled={busy === a.appId} onClick={() => restart(a.appId)}>{busy === a.appId ? 'Starting' : 'Restart'}</button>
            <button onClick={() => onLogs(a.appId)}>Logs</button>
            <button onClick={() => close(a.appId)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
