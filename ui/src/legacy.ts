// The shared UMD models in src/core set window globals as a side effect and are not ES modules.
// runView reads window.PortPilotStatus, so status.js loads first.
import '../../src/core/status.js';
import '../../src/core/runView.js';
import '../../src/core/browserView.js';
import type { BrowserSession, ReopenResult, Run } from './host';

export interface RunState { state: string; word: string; glyph: string; token: string; reason: string; text: string }
interface RunViewApi {
  labelOf(run: Run): string;
  formatWhen(run: Run): string;
  runStateOf(run: Run, live: boolean): RunState;
  filterRuns(runs: Run[], f: { query?: string }): Run[];
}
export const runView = (): RunViewApi => (window as any).PortPilotRunView;

interface BrowserViewApi {
  sessionWhen(e: BrowserSession): string;
  startedByWord(by: BrowserSession['startedBy']): string;
  endedWord(e: BrowserSession): string;
  tabLabel(t: { title?: string; url?: string }): string;
  shownTabs(e: BrowserSession): { shown: BrowserSession['tabs']; more: number };
  reopenText(res: ReopenResult): string;
}
export const browserView = (): BrowserViewApi => (window as any).PortPilotBrowserView;
