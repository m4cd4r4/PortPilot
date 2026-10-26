import { openPageSession } from './cdpClient';
import { BrowserTab } from './browserModel';

// A preview is one downscaled JPEG of a profile's front page tab. This is the only code in the
// extension that reads page content, so it runs only for profiles the user switched previews on for.

/** Width of the stored thumbnail, in CSS pixels; the card shows it at roughly half this. */
export const THUMB_WIDTH = 480;
const QUALITY = 55;
/**
 * A browser window another window covers reports its page as hidden, and Chromium then makes a
 * screenshot wait for its next slow frame: measured 8-10 s (0.1 s when the window is visible).
 */
export const CAPTURE_TIMEOUT_MS = 20_000;

export interface Capture {
  /** base64 JPEG, no data: prefix */
  jpeg: string;
  title: string;
  url: string;
  at: number;
}

/** The tab to picture: the first real web page. /json lists the most recently used tab first. */
export function pickPreviewTab(tabs: BrowserTab[]): BrowserTab | undefined {
  return tabs.find(t => /^https?:\/\//i.test(t.url));
}

export async function captureTab(port: number, tab: BrowserTab, now: () => number = Date.now): Promise<Capture> {
  const session = await openPageSession(port, tab.id, CAPTURE_TIMEOUT_MS);
  try {
    const metrics = await session.send<{ cssVisualViewport?: { clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics');
    const vw = Math.max(1, Math.round(metrics.cssVisualViewport?.clientWidth || 1280));
    const vh = Math.max(1, Math.round(metrics.cssVisualViewport?.clientHeight || 800));
    const scale = Math.min(1, THUMB_WIDTH / vw);
    const shot = await session.send<{ data: string }>('Page.captureScreenshot', {
      format: 'jpeg', quality: QUALITY, optimizeForSpeed: true,
      clip: { x: 0, y: 0, width: vw, height: vh, scale },
    });
    if (typeof shot.data !== 'string' || !shot.data) throw new Error('The browser returned no image.');
    return { jpeg: shot.data, title: tab.title, url: tab.url, at: now() };
  } finally {
    session.close();
  }
}
