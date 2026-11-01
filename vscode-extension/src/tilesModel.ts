// Pure model for the Tiles view: which apps and browser profiles become tiles, in what order,
// and which pictures still need sending to the webview. No `vscode` import, so the root unit
// tests can require the compiled out/tilesModel.js (tests/vscode-tiles-model.test.cjs).

import { StateKey, compareKeys, isIdle, previewFor, RowThumbRef } from './treeModel';
import type { BrowserRow } from './browserModel';

export type Lamp = 'running' | 'blocked' | 'crashed' | 'starting' | 'stopped';

export interface AppInput {
  id: string;
  name: string;
  port: number | null;
  state: StateKey;
  /** The state's word, as the Apps rows say it ("Running", "Crashed"). */
  word: string;
  favorite: boolean;
  branch?: string | null;
  /** Page picture of the open run, when the desktop took one. */
  thumb?: string | null;
}

export interface AppTile {
  id: string;
  name: string;
  port: number | null;
  lamp: Lamp;
  word: string;
  favorite: boolean;
  branch: string;
  letter: string;
  /** Key of the picture in the webview's picture map; '' when the tile has none. */
  img: string;
  canOpen: boolean;
  canStart: boolean;
  canStop: boolean;
}

export interface BrowserTile {
  name: string;
  port: number;
  lamp: Lamp;
  word: string;
  letter: string;
  img: string;
  /** Running with a web page open: a click brings it to the front. */
  canFocus: boolean;
  canStart: boolean;
  canStop: boolean;
  /** "claude 4a2f" when an agent session holds the profile. */
  leasedTo: string;
}

export interface TilesState {
  apps: AppTile[];
  stoppedApps: AppTile[];
  browsers: BrowserTile[];
}

const LAMPS: Record<StateKey, Lamp> = {
  crashed: 'crashed',
  conflict: 'blocked',
  error: 'crashed',
  starting: 'starting',
  running: 'running',
  stopped: 'stopped',
};

/** First letter, upper-cased; a stand-in picture for a tile with none. */
export const letterOf = (name: string): string => (Array.from(name.trim())[0] ?? '?').toUpperCase();

/** Picture key for an app: the run's thumbnail path, so a new capture is a new key. */
export const appImgKey = (thumb: string | null | undefined): string => (thumb ? `run:${thumb}` : '');

/** Picture key for a browser: name plus the art file's mtime, so a changed picture is a new key. */
export const artImgKey = (name: string, stamp: number | null | undefined): string => (stamp ? `art:${name.toLowerCase()}@${stamp}` : '');

/**
 * Running and attention-needing apps become tiles, favourites first inside each state, then name
 * (the Apps tree's own order). Idle apps come back separately, in the same order, for the compact list.
 */
export function buildAppTiles(apps: AppInput[], showPictures = true): { live: AppTile[]; stopped: AppTile[] } {
  const keyOf = (a: AppInput) => ({ state: a.state, name: a.name, favorite: a.favorite });
  const sorted = [...apps].sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  const tile = (a: AppInput): AppTile => {
    const running = a.state === 'running';
    return {
      id: a.id,
      name: a.name,
      port: a.port,
      lamp: LAMPS[a.state] ?? 'stopped',
      word: a.word,
      favorite: a.favorite,
      branch: a.branch || '',
      letter: letterOf(a.name),
      img: showPictures && running ? appImgKey(a.thumb) : '',
      canOpen: running && a.port != null,
      canStart: !running,
      canStop: running,
    };
  };
  return {
    live: sorted.filter(a => !isIdle(keyOf(a))).map(tile),
    stopped: sorted.filter(a => isIdle(keyOf(a))).map(tile),
  };
}

const BROWSER_LAMP: Record<BrowserRow['state'], Lamp> = {
  running: 'running',
  held: 'blocked',
  stopped: 'stopped',
  unknown: 'stopped',
};

/** One tile per profile, in the Browsers tree's own order (running, held, then stopped; rows arrive sorted). */
export function buildBrowserTiles(rows: BrowserRow[], artStamp: (name: string) => number | null): BrowserTile[] {
  return rows.map(r => ({
    name: r.name,
    port: r.port,
    lamp: BROWSER_LAMP[r.state],
    word: r.stateWord,
    letter: letterOf(r.name),
    img: artImgKey(r.name, artStamp(r.name)),
    canFocus: r.state === 'running' && r.tabs.some(t => /^https?:\/\//i.test(t.url)),
    canStart: r.state === 'stopped',
    canStop: r.state === 'running',
    leasedTo: r.leasedTo || '',
  }));
}

/** The thumbnail an app's tile may show: the Apps row's own rule (listening, runtime record, matching port). */
export function thumbOf(
  byApp: Record<string, RowThumbRef | undefined>,
  appId: string,
  hasRuntimeRecord: boolean,
  livePort: number | null | undefined
): string | null {
  return previewFor(byApp, appId, hasRuntimeRecord, livePort)?.thumb ?? null;
}

/**
 * Which pictures the webview still lacks. The webview keeps every picture it was sent, keyed;
 * a tile refers to one by key, so a ten-second repaint sends no image bytes twice.
 */
export class ImageSync {
  private sent = new Set<string>();

  /** Keys in `wanted` not yet sent. They count as sent from now on. */
  pending(wanted: Iterable<string>): string[] {
    const out: string[] = [];
    for (const k of wanted) {
      if (k && !this.sent.has(k)) { this.sent.add(k); out.push(k); }
    }
    return out;
  }

  /** A key whose file could not be read: forget it, so a later repaint tries again. */
  failed(key: string): void {
    this.sent.delete(key);
  }

  /** The webview was recreated and holds nothing. */
  reset(): void {
    this.sent.clear();
  }
}

/** Every picture key a state refers to. */
export function imageKeys(state: TilesState): string[] {
  return [...state.apps, ...state.stoppedApps].map(t => t.img).concat(state.browsers.map(t => t.img)).filter(Boolean);
}
