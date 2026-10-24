import { useEffect } from 'react';
import type { Snapshot } from '../host';
import { cards, type Tally, type View } from '../model';
import type { Thumbs } from '../useThumbs';

interface Props { t: Tally; loaded: boolean; onView: (v: View) => void; snap: Snapshot; thumbs: Thumbs }

const KEY = 'portpilot-home-tally';
type Counts = Pick<Tally, 'running' | 'apps' | 'profilesUp' | 'profiles'>;

function lastCounts(): Counts | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && ['running', 'apps', 'profilesUp', 'profiles'].every((k) => Number.isInteger(v[k]))) return v;
  } catch { /* storage can be unavailable */ }
  return null;
}

export function Home({ t, loaded, onView, snap, thumbs }: Props) {
  // The first read takes a couple of seconds on a big library: show the last known counts, dimmed, instead of dashes.
  const last = loaded ? null : lastCounts();
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify({ running: t.running, apps: t.apps, profilesUp: t.profilesUp, profiles: t.profiles })); } catch { /* ignore */ }
  }, [loaded, t.running, t.apps, t.profilesUp, t.profiles]);
  const num = (n: number, k: keyof Counts) => (loaded ? String(n) : last ? String(last[k]) : '');
  // The Localhost tile previews up to three running apps that already have a screenshot.
  const previews = cards(snap)
    .filter((c) => c.state === 'running' && thumbs.byApp[c.app.id])
    .slice(0, 3);
  return (
    <section className={`home${loaded ? '' : last ? ' stale' : ' loading'}`} aria-label="Home" aria-busy={!loaded}>
      <button className="tile" onClick={() => onView('localhost')}>
        <span className="tile-title">Localhost</span>
        <span className="tile-count">{num(t.running, 'running')}<small> running</small></span>
        <span className="tile-sub">{num(t.apps, 'apps')} apps registered</span>
        {previews.length > 0 ? (
          <span className="tile-previews" aria-hidden="true">
            {previews.map((c) => <img key={c.app.id} src={thumbs.byApp[c.app.id].url} alt="" />)}
          </span>
        ) : <span className="tile-art" aria-hidden="true" />}
      </button>
      <button className="tile" onClick={() => onView('browsers')}>
        <span className="tile-title">Browsers</span>
        <span className="tile-count">{num(t.profilesUp, 'profilesUp')}<small> open</small></span>
        <span className="tile-sub">{num(t.profiles, 'profiles')} profiles</span>
        <span className="tile-art alt" aria-hidden="true" />
      </button>
    </section>
  );
}
