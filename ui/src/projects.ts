// src/core/appProjects.js is a UMD file like appClusters.js: it sets window.PortPilotProjects and reads
// window.PortPilotClusters, so clusters.ts is imported first.
import './clusters';
import '../../src/core/appProjects.js';
import type { AppRec, Group, Run } from './host';
import type { Card } from './model';

export interface Project { key: string; name: string }
export interface Section { id: string; name: string; kind: 'group' | 'project' | 'rest'; cards: Card[]; active: boolean }
interface Api {
  projectsOf(apps: AppRec[], roots?: Record<string, string>): Record<string, Project>;
  sections(cards: Card[], groups: Group[], projects: Record<string, Project>): Section[];
  lastRunByApp(runs: Run[]): Record<string, number>;
  olderIds(cards: Card[], lastRun: Record<string, number>, now: number, days?: number): Set<string>;
  OLDER_DAYS: number;
}
const api = (): Api => (window as any).PortPilotProjects as Api;

export const projectsOf: Api['projectsOf'] = (apps, roots) => api().projectsOf(apps, roots);
export const sections: Api['sections'] = (cards, groups, projects) => api().sections(cards, groups, projects);
export const olderIds: Api['olderIds'] = (cards, lastRun, now, days) => api().olderIds(cards, lastRun, now, days);
export const OLDER_DAYS = (): number => api().OLDER_DAYS;

const KEY = 'portpilot-last-run';

function remembered(): Record<string, number> {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

/** The last-run times this window has seen, before history is read: the fold is right on the first paint. */
export const rememberedRuns = remembered;

/**
 * Latest run per app. Run history is capped (1,000 runs by default), so on a busy machine it stops
 * reaching back 30 days: every time seen is kept here, and only apps still registered are kept.
 */
export function mergeLastRuns(runs: Run[], apps: AppRec[]): Record<string, number> {
  const seen = api().lastRunByApp(runs);
  const old = remembered();
  const out: Record<string, number> = {};
  for (const a of apps) {
    const t = Math.max(seen[a.id] || 0, Number(old[a.id]) || 0);
    if (t) out[a.id] = t;
  }
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage can be unavailable */ }
  return out;
}
