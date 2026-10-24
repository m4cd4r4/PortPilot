import { useEffect, useRef, useState } from 'react';
import type { Account, Host, Profile } from '../host';
import type { BrowserArt } from '../useBrowserMeta';

interface Props {
  host: Host;
  /** null = adding a new profile */
  profile: Profile | null;
  taken: Profile[];
  art: BrowserArt;
  onClose: () => void;
  onDone: () => void;
}

const BROWSERS = ['chrome', 'edge', 'brave', 'chromium', 'opera', 'vivaldi'];
const MODES = ['headed', 'offscreen', 'headless'];
const ACCOUNTS_MAX = 10;

/** First free debug port at or above 9222 that no profile uses. */
function nextPort(taken: Profile[]): number {
  const used = new Set(taken.map((p) => p.port));
  let port = 9222;
  while (used.has(port)) port += 1;
  return port;
}

export function BrowserDrawer({ host, profile, taken, art, onClose, onDone }: Props) {
  const adding = !profile;
  const [name, setName] = useState(profile?.name || '');
  const [port, setPort] = useState(String(profile?.port ?? nextPort(taken)));
  const [browser, setBrowser] = useState(profile?.browser || 'brave');
  const [mode, setMode] = useState(profile?.mode || 'headed');
  const [url, setUrl] = useState(profile?.url || '');
  const [purpose, setPurpose] = useState(profile?.purpose || '');
  const [note, setNote] = useState(profile?.note || '');
  const [sites, setSites] = useState((profile?.sites || []).join(', '));
  const [accounts, setAccounts] = useState<Account[]>((profile?.accounts || []).map((a) => ({ ...a })));
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const picture = profile ? art.byName[profile.name] : undefined;

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await host.saveBrowser(profile ? profile.name : null, {
        ...(adding ? { name: name.trim() } : {}),
        port, browser, mode, url: url.trim(), purpose, note, sites: sites.split(/[\s,;]+/).filter(Boolean), accounts,
      });
      onDone();
    });
  };

  const setAccount = (i: number, key: keyof Account, value: string) =>
    setAccounts((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const doRemove = () => run(async () => { await host.removeBrowser(profile!.name); onDone(); });

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="drawer" role="dialog" aria-modal="true" aria-label={adding ? 'Add profile' : `Edit ${profile!.name}`} onSubmit={save}>
        <header className="drawer-head">
          <h2>{adding ? 'Add profile' : profile!.name}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">Close</button>
        </header>

        <div className="drawer-body">
          {adding && (
            <label>Name
              <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="upwork" required maxLength={64} />
              <small>Letters, digits, dot, dash, underscore. It names the profile folder, so it cannot change later.</small>
            </label>
          )}
          <div className="row2">
            <label>Debug port
              <input ref={adding ? undefined : first} value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" required />
            </label>
            <label>Browser
              <select value={browser} onChange={(e) => setBrowser(e.target.value)}>
                {[...new Set([browser, ...BROWSERS])].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label>Window
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <label>Start page
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://upwork.com" />
          </label>
          <label>What it is for
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Upwork job sweeps" maxLength={200} />
          </label>
          <label>Sites
            <input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="upwork.com, www.upwork.com" />
            <small>Hostnames this profile is signed in to. Used to find the right profile and to read its sign-in state.</small>
          </label>
          <label>Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
          </label>

          <fieldset className="accounts">
            <legend>Accounts</legend>
            <small>Labels only, so you can tell logins apart. Never type a password here.</small>
            {accounts.map((a, i) => (
              <div className="account-row" key={i}>
                <input aria-label={`Account ${i + 1} platform`} placeholder="Platform" value={a.platform || ''} maxLength={40} onChange={(e) => setAccount(i, 'platform', e.target.value)} />
                <input aria-label={`Account ${i + 1} username`} placeholder="Username" value={a.username || ''} maxLength={120} onChange={(e) => setAccount(i, 'username', e.target.value)} />
                <input aria-label={`Account ${i + 1} note`} placeholder="Note" value={a.note || ''} maxLength={200} onChange={(e) => setAccount(i, 'note', e.target.value)} />
                <button type="button" className="icon" aria-label={`Remove account ${i + 1}`} onClick={() => setAccounts((rows) => rows.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            {accounts.length < ACCOUNTS_MAX && (
              <button type="button" onClick={() => setAccounts((rows) => [...rows, {}])}>Add account</button>
            )}
          </fieldset>

          {profile && (
            <fieldset className="art-field">
              <legend>Picture</legend>
              <div className="art-row">
                <span className="art-prev" aria-hidden="true">{picture ? <img src={picture} alt="" /> : null}</span>
                <div className="art-btns">
                  <button type="button" disabled={working} onClick={() => run(async () => { if (!(await art.refresh(profile.name))) setError('No picture found on that site.'); })}>Fetch from site</button>
                  <button type="button" disabled={working} onClick={() => run(async () => { await art.choose(profile.name); })}>Choose file</button>
                  <button type="button" disabled={working || !picture} onClick={() => run(() => art.clear(profile.name))}>Remove picture</button>
                </div>
              </div>
            </fieldset>
          )}

          {error && <p className="notice" role="alert">{error}</p>}
        </div>

        <footer className="drawer-foot">
          {profile && (
            confirmRemove
              ? <span className="danger-row">Remove from PortPilot? Its folder and sign-ins stay on disk.
                <button type="button" className="danger" disabled={working} onClick={doRemove}>Yes, remove</button>
                <button type="button" onClick={() => setConfirmRemove(false)}>Keep</button></span>
              : <button type="button" className="danger-ghost" onClick={() => setConfirmRemove(true)}>Remove profile</button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={working}>{working ? 'Saving' : adding ? 'Add' : 'Save'}</button>
        </footer>
      </form>
    </div>
  );
}
