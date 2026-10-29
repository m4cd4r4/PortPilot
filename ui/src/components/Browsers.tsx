import { useMemo, useState, type SyntheticEvent } from 'react';
import type { Host, Profile, SignIn, Snapshot } from '../host';
import { BROWSER_GROUPS, ago, browserCards, hueOf, type BrowserCard } from '../model';
import { VIEWS, setPrefs, usePrefs, type Prefs } from '../prefs';
import { useBrowserArt, useSignIns, type BrowserArt } from '../useBrowserMeta';
import { BrowserDrawer } from './BrowserDrawer';

interface Props { host: Host; snap: Snapshot; onDone: () => void }

const MAX_CHIPS = 3;

export function Browsers({ host, snap, onDone }: Props) {
  const prefs = usePrefs();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>('');
  // null = closed; { name: null } = adding; { name } = editing that profile
  const [drawer, setDrawer] = useState<{ name: string | null } | null>(null);
  const list = useMemo(() => browserCards(snap, query), [snap, query]);
  const art = useBrowserArt(host, snap.profiles);
  const signIns = useSignIns(host, snap.profiles);

  const act = async (name: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(name);
    try { setError(''); await fn(); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const actions: Actions = {
    start: (p) => act(p.name, () => host.startBrowser(p.name)),
    stop: (p) => act(p.name, () => host.stopBrowser(p.name)),
    release: (p) => act(p.name, () => host.releaseBrowser(p.name)),
    edit: (p) => setDrawer({ name: p.name }),
    setup: (p, which) => act(p.name, () => host.openSignInSetup(p.name, which)),
  };

  const grid = (rows: BrowserCard[]) => (
    <div className={`cards ${prefs.view === 'cards' ? 'tiles' : prefs.view}`} data-density={prefs.density} data-status={prefs.status} data-thumbs={prefs.thumbs}>
      {rows.map((c) => <ProfileCard key={c.profile.name} c={c} prefs={prefs} art={art} signIn={signIns[c.profile.name]} busy={busy === c.profile.name} actions={actions} />)}
    </div>
  );

  const body = () => {
    if (!snap.profiles.length) {
      return (
        <div className="empty-note">
          <p>No browser profiles yet. A profile is a separate browser with its own logins and its own debug port.</p>
          <button className="primary" onClick={() => setDrawer({ name: null })}>Add your first profile</button>
        </div>
      );
    }
    if (!list.length) return <p className="empty-note">No profile matches that filter.</p>;
    if (prefs.grouping) {
      return BROWSER_GROUPS.map((g) => {
        const rows = list.filter((c) => c.group === g.id);
        if (!rows.length) return null;
        return (
          <section key={g.id} aria-label={g.label}>
            <h3 className="group-h">{g.label}<small>{rows.length}</small></h3>
            {grid(rows)}
          </section>
        );
      });
    }
    return grid(list);
  };

  return (
    <section className="gallery-view" aria-label="Browsers">
      <div className="toolbar">
        <input className="filter" type="search" placeholder="Filter profiles" aria-label="Filter profiles" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="toolbar-end">
          <div className="seg small" role="group" aria-label="View mode">
            {VIEWS.map((m) => (
              <button key={m.v} aria-pressed={prefs.view === m.v} className={prefs.view === m.v ? 'on' : ''} onClick={() => setPrefs({ view: m.v })}>{m.l}</button>
            ))}
          </div>
          <button aria-pressed={prefs.grouping} className={prefs.grouping ? 'tog on' : 'tog'} onClick={() => setPrefs({ grouping: !prefs.grouping })}>Grouped</button>
          <button className="primary" onClick={() => setDrawer({ name: null })}>Add profile</button>
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      {body()}
      {drawer && (
        <BrowserDrawer host={host} profile={drawer.name ? snap.profiles.find((p) => p.name === drawer.name) || null : null}
          taken={snap.profiles} art={art} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); onDone(); }} />
      )}
    </section>
  );
}

interface Actions {
  start(p: Profile): void; stop(p: Profile): void; release(p: Profile): void; edit(p: Profile): void;
  setup(p: Profile, which: 'sync' | 'passwords'): void;
}

const GLYPH = { running: '●', conflict: '▲', stopped: '○' } as const;
const WORD: Record<BrowserCard['group'], string> = { inuse: 'in use', open: 'open', blocked: 'blocked', stopped: 'stopped' };
const SIGN_LABEL: Record<SignIn, string> = { in: 'Signed in', out: 'Signed out', unknown: '' };

function ProfileCard({ c, prefs, art, signIn, busy, actions }: { c: BrowserCard; prefs: Prefs; art: BrowserArt; signIn?: SignIn; busy: boolean; actions: Actions }) {
  const p = c.profile;
  const picture = art.byName[p.name];
  const up = p.state === 'up';
  const accounts = p.accounts || [];
  const hue = hueOf(p.name);
  const lease = p.leasedTo;
  const tiles = prefs.view === 'cards' || prefs.view === 'gallery';
  const showShot = tiles || prefs.thumbs === 'inline';
  const compact = prefs.view === 'compact';
  const state = up ? 'running' : c.group === 'blocked' ? 'conflict' : 'stopped';
  const [small, setSmall] = useState(false);
  // A favicon or touch icon is a small square: show it whole on the gradient, not stretched to fill the hero.
  const sized = (e: SyntheticEvent<HTMLImageElement>) => setSmall(e.currentTarget.naturalWidth < 320);
  return (
    <article className={`card bcard ${c.group}`} data-profile={p.name} data-group={c.group}>
      {showShot && <button className={`shot bshot${picture && small ? ' small-art' : ''}`} onClick={() => actions.edit(p)} aria-label={`Edit ${p.name}`}
        style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 30%), hsl(${(hue + 40) % 360} 55% 18%))` }}>
        {picture
          ? <img src={picture} alt="" loading="lazy" onLoad={sized} />
          : <span className="letter" aria-hidden="true" style={{ color: `hsl(${hue} 70% 82%)` }}>{p.name.slice(0, 1).toUpperCase()}</span>}
        {c.group === 'blocked' && <span className="badge warn">Port held</span>}
      </button>}
      <div className="meta">
        <div className="title">
          {prefs.status === 'dot'
            ? <span className={`dot ${state}`} aria-hidden="true" />
            : <span className={`stat ${state}`}><span aria-hidden="true">{GLYPH[state]}</span> {WORD[c.group]}</span>}
          <span className="name">{p.name}</span>
          {up && signIn && signIn !== 'unknown' && <span className={`pill ${signIn}`} data-signin={signIn}>{SIGN_LABEL[signIn]}</span>}
        </div>
        <div className="sub">
          {p.port && <span>:{p.port}</span>}
          {p.browser && <span>{p.browser}</span>}
          {p.mode && p.mode !== 'headed' && <span>{p.mode}</span>}
          {up && p.tabs && <span>{p.tabs.length} tab{p.tabs.length === 1 ? '' : 's'}</span>}
        </div>
        {!compact && p.purpose && <p className="purpose">{p.purpose}</p>}
        {!compact && accounts.length > 0 && (
          <div className="chips" aria-label="Accounts">
            {accounts.slice(0, MAX_CHIPS).map((a, i) => (
              <span key={i} className="chip" title={a.note || undefined}>{[a.platform, a.username].filter(Boolean).join(' · ')}</span>
            ))}
            {accounts.length > MAX_CHIPS && <span className="chip more">+{accounts.length - MAX_CHIPS}</span>}
          </div>
        )}
        {up && signIn === 'out' && (!p.browser || p.browser === 'brave') && !compact && (
          <div className="signin-setup" data-signin-setup role="group" aria-label="Set up sign-ins">
            <span>Sign-ins:</span>
            <button onClick={() => actions.setup(p, 'sync')} disabled={busy}>Brave Sync</button>
            <button onClick={() => actions.setup(p, 'passwords')} disabled={busy}>Import passwords</button>
          </div>
        )}
        {lease && (
          <div className="lease" data-lease>
            <span>{lease.starting ? 'Starting for' : 'In use by'} {lease.by}{lease.since ? ` · ${ago(lease.since)}` : ''}</span>
            {!lease.starting && <button onClick={() => actions.release(p)} disabled={busy}>Release</button>}
          </div>
        )}
        {c.group === 'blocked' && p.warning && !compact && <p className="note-warn">{p.warning}</p>}
      </div>
      <div className="acts">
        {up
          ? <button onClick={() => actions.stop(p)} disabled={busy}>{busy ? 'Working' : 'Stop'}</button>
          : <button onClick={() => actions.start(p)} disabled={busy || c.group === 'blocked'}>{busy ? 'Working' : 'Start'}</button>}
        <button onClick={() => actions.edit(p)}>Edit</button>
      </div>
    </article>
  );
}
