// Pure model for the Browser previews view: which profiles have previews on, how often one may be
// captured, and the age label on a card. No `vscode` import, so the root unit tests can require the
// compiled out/previewModel.js (tests/vscode-browser-preview.test.cjs).

// A preview is a glance, not a video; a covered browser window also takes up to 10 s per picture.
export const MIN_GAP_MS = 30_000;

/** The setting's value as a clean list: strings only, trimmed, no blanks, no case-insensitive repeats. */
export function parsePreviewNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const name = v.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export const hasPreview = (names: string[], profile: string): boolean => names.some(n => n.toLowerCase() === profile.toLowerCase());

export function withPreview(names: string[], profile: string, on: boolean): string[] {
  const rest = names.filter(n => n.toLowerCase() !== profile.toLowerCase());
  return on ? [...rest, profile] : rest;
}

/**
 * One capture at a time, and at most one attempt per profile per MIN_GAP_MS (30 s). Failures count as
 * attempts, so a profile whose page cannot be pictured is not hammered.
 */
export class CaptureGate {
  private busy = false;
  private last = new Map<string, number>();

  constructor(private readonly minGapMs = MIN_GAP_MS) {}

  /** 'go' means the caller now holds the slot and must call done(). */
  enter(profile: string, now: number): 'go' | 'throttled' | 'busy' {
    const key = profile.toLowerCase();
    if (now - (this.last.get(key) ?? -Infinity) < this.minGapMs) return 'throttled';
    if (this.busy) return 'busy';
    this.busy = true;
    this.last.set(key, now);
    return 'go';
  }

  done(): void {
    this.busy = false;
  }

  /** A forced look (the card's refresh button) skips the gap but still takes the single slot. */
  forget(profile: string): void {
    this.last.delete(profile.toLowerCase());
  }
}

/** "just now", "12 s ago", "3 min ago", "2 h ago". */
export function ageLabel(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
