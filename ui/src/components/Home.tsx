import type { Tally, View } from '../model';

interface Props { t: Tally; loaded: boolean; onView: (v: View) => void }

export function Home({ t, loaded, onView }: Props) {
  const num = (n: number) => (loaded ? String(n) : '-');
  return (
    <section className="home" aria-label="Home">
      <button className="tile" onClick={() => onView('localhost')}>
        <span className="tile-title">Localhost</span>
        <span className="tile-count">{num(t.running)}<small> running</small></span>
        <span className="tile-sub">{num(t.apps)} apps registered</span>
        <span className="tile-art" aria-hidden="true" />
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
