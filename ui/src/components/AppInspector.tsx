import { useEffect, useState } from 'react';
import type { AppRec, DiagnoseStatus, Host, ShareInfo } from '../host';

interface Props { host: Host; app: AppRec; port?: number; running: boolean; crashed: boolean; onClose: () => void }

type Tab = 'logs' | 'share' | 'diagnose';

export function AppInspector({ host, app, port, running, crashed, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('logs');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'logs', label: 'Logs', show: true },
    { id: 'share', label: 'Share', show: running && !!port },
    { id: 'diagnose', label: 'Diagnose', show: crashed },
  ];

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer wide" role="dialog" aria-modal="true" aria-label={`${app.name} details`}>
        <header className="drawer-head">
          <h2>{app.name}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <nav className="seg small tabs" role="tablist" aria-label="Details">
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="drawer-body">
          {tab === 'logs' && <Logs host={host} app={app} running={running} />}
          {tab === 'share' && port && <Share host={host} port={port} />}
          {tab === 'diagnose' && <Diagnose host={host} app={app} />}
        </div>
      </div>
    </div>
  );
}

function Logs({ host, app, running }: { host: Host; app: AppRec; running: boolean }) {
  const [logs, setLogs] = useState<{ stdout: string; stderr: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const read = () => host.appLogs(app.id).then((l) => { if (live) setLogs(l); }).catch((e) => { if (live) setError((e as Error).message); });
    read();
    const t = running ? setInterval(read, 2000) : undefined;
    return () => { live = false; clearInterval(t); };
  }, [host, app.id, running]);

  if (error) return <p className="notice" role="alert">{error}</p>;
  if (!logs) return <p className="set-note">Reading output</p>;
  if (!logs.stdout && !logs.stderr) {
    return <p className="set-note">{running ? 'No output yet.' : 'No output. PortPilot keeps output only for apps it started and that are still running.'}</p>;
  }
  return (
    <>
      {logs.stderr && <><h3 className="log-h">Errors</h3><pre className="log err" tabIndex={0}>{logs.stderr}</pre></>}
      {logs.stdout && <><h3 className="log-h">Output</h3><pre className="log" tabIndex={0}>{logs.stdout}</pre></>}
    </>
  );
}

function Share({ host, port }: { host: Host; port: number }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { host.shareInfo(port).then(setInfo).catch((e) => setError((e as Error).message)); }, [host, port]);
  if (error) return <p className="notice" role="alert">{error}</p>;
  if (!info) return <p className="set-note">Looking up the network address</p>;
  return (
    <>
      <p className="share-url"><span>This computer</span><code>{info.localUrl}</code></p>
      {info.lanUrl
        ? <>
          <p className="share-url"><span>Same Wi-Fi</span><code>{info.lanUrl}</code></p>
          {info.qrDataUrl && <img className="qr" src={info.qrDataUrl} alt={`QR code for ${info.lanUrl}`} />}
          <p className="set-note">Phones and other computers on this network can open it. If the page will not load, Windows Firewall may be blocking the port.</p>
        </>
        : <p className="set-note">No network address found, so this app can only be reached from this computer.</p>}
    </>
  );
}

function Diagnose({ host, app }: { host: Host; app: AppRec }) {
  const [status, setStatus] = useState<DiagnoseStatus | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    host.diagnoseStatus(app.id).then((s) => { setStatus(s); setBusy(s.running); }).catch((e) => setError((e as Error).message));
    return host.onDiagnose((ev) => {
      if (ev.appId !== app.id) return;
      if (ev.kind === 'tool' && ev.label) setActivity((a) => [...a, ev.label!]);
      else if (ev.kind === 'text' && ev.text) setAnswer((a) => (a ? `${a}\n\n` : '') + ev.text);
      else if (ev.kind === 'error') setError(ev.text || 'Diagnosis failed');
      else if (ev.kind === 'end') setBusy(false);
    });
  }, [host, app.id]);

  const start = async () => {
    setError(''); setActivity([]); setAnswer(''); setBusy(true);
    try {
      if (!status?.consent) { await host.diagnoseConsent(); setStatus((s) => (s ? { ...s, consent: true } : s)); }
      await host.diagnoseStart(app.id);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  if (!status) return error ? <p className="notice" role="alert">{error}</p> : <p className="set-note">Checking for Claude Code</p>;
  if (!status.cli) return <p className="set-note">Diagnose runs your own Claude Code in read-only mode, and it was not found on this computer.</p>;
  return (
    <>
      {!status.consent && <p className="set-note">Diagnose sends this app's recent error output, command and folder to your own Claude Code, read-only. Starting it counts as your consent.</p>}
      <div className="inline-row">
        <button className="primary" disabled={busy} onClick={start}>{busy ? 'Diagnosing' : 'Diagnose the crash'}</button>
        {busy && <button onClick={() => host.diagnoseCancel(app.id).then(() => setBusy(false))}>Cancel</button>}
      </div>
      {activity.length > 0 && <ul className="diag-activity">{activity.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      {answer && <pre className="log answer" tabIndex={0}>{answer}</pre>}
      {error && <p className="notice" role="alert">{error}</p>}
    </>
  );
}
