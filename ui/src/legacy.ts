// The shared UMD models in src/core set window globals as a side effect and are not ES modules.
// runView reads window.PortPilotStatus, so status.js loads first.
import '../../src/core/status.js';
import '../../src/core/runView.js';
import type { Run } from './host';

export interface RunState { state: string; word: string; glyph: string; token: string; reason: string; text: string }
interface RunViewApi {
  labelOf(run: Run): string;
  formatWhen(run: Run): string;
  runStateOf(run: Run, live: boolean): RunState;
  filterRuns(runs: Run[], f: { query?: string }): Run[];
}
export const runView = (): RunViewApi => (window as any).PortPilotRunView;
