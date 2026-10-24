import type { Snapshot } from '../host';
import { cards, type Tally, type View } from '../model';
import type { Thumbs } from '../useThumbs';

interface Props { t: Tally; loaded: boolean; onView: (v: View) => void; snap: Snapshot; thumbs: Thumbs }

export function Home({ t, loaded, onView, snap, thumbs }: Props) {
  const num = (n: number) => (loaded ? String(n) : '-');
  // The Localhost tile previews up to three running apps that already have a screenshot.
  const previews = cards(snap)
    .filter((c) => c.state === 'running' && thumbs.byApp[c.app.id])
    .slice(0, 3);
  return (
    <section className="home" aria-label="Home">
      <button className="tile" onClick={() => onView('localhost')}>
        <span className="tile-title">Localhost</span>
        <span className="tile-count">{num(t.running)}<small> running</small></span>
        <span className="tile-sub">{num(t.apps)} apps registered</span>
        {previews.length > 0 ? (
          <span className="tile-previews" aria-hidden="true">
            {previews.map((c) => <img key={c.app.id} src={thumbs.byApp[c.app.id].url} alt="" />)}
          </span>
        ) : <span className="tile-art" aria-hidden="true" />}
      </button>
      <button className="tile" onClick={() => onView('browsers')}>
        <span className="tile-title">Browsers</span>
        <span className="tile-count">{num(t.profilesUp)}<small> open</small></span>
        <span className="tile-sub">{num(t.profiles)} profiles</span>
        <span className="tile-art alt" aria-hidden="true" />
      </button>
    </section>
  );
}
