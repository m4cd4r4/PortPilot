// src/core/palette.js is a UMD file: it sets window.PortPilotPalette as a side effect and is not an ES module.
import '../../src/core/palette.js';

export interface Command {
  id: string; kind: string; label: string; hint?: string; keywords?: string; confirm?: string;
  action: { type: string; id?: string; name?: string; port?: number; view?: string };
}
interface PaletteApi {
  buildCommands(s: unknown): Command[];
  rank(query: string, commands: Command[]): Command[];
  moveIndex(index: number, count: number, delta: number): number;
}
export const palette = (): PaletteApi => (window as any).PortPilotPalette;
