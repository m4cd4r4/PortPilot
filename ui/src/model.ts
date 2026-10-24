import type { Snapshot } from './host';

export type View = 'home' | 'localhost' | 'browsers';
export const VIEWS: Array<{ view: View; label: string }> = [
  { view: 'home', label: 'Home' },
  { view: 'localhost', label: 'Localhost' },
  { view: 'browsers', label: 'Browsers' },
];

export interface Tally { running: number; apps: number; profilesUp: number; profiles: number; warnings: string[] }

/** Counts for the Home tiles and the slim warning banner. Pure. */
export function tally(s: Snapshot): Tally {
  const top = s.apps.filter((a) => !a.parentId);
  const warnings = s.conflicts.map((c) => {
    const app = s.apps.find((a) => a.id === c.appId);
    const name = app?.name || c.appName;
    const who = c.occupiedBy?.processName ? c.occupiedBy.processName.replace(/\.exe$/i, '') : 'another process';
    return `${name || 'An app'} is blocked: :${c.port} is held by ${who}`;
  });
  return {
    running: top.filter((a) => s.running[a.id]).length,
    apps: top.length,
    profilesUp: s.profiles.filter((p) => p.state === 'up').length,
    profiles: s.profiles.length,
    warnings,
  };
}
