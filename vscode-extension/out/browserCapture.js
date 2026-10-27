"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTURE_TIMEOUT_MS = exports.THUMB_WIDTH = void 0;
exports.pickPreviewTab = pickPreviewTab;
exports.captureTab = captureTab;
const cdpClient_1 = require("./cdpClient");
// A preview is one downscaled JPEG of a profile's front page tab. This is the only code in the
// extension that reads page content, so it runs only for profiles the user switched previews on for.
/** Width of the stored thumbnail, in CSS pixels; the card shows it at roughly half this. */
exports.THUMB_WIDTH = 480;
const QUALITY = 55;
/**
 * A browser window another window covers reports its page as hidden, and Chromium then makes a
 * screenshot wait for its next slow frame: measured 8-10 s (0.1 s when the window is visible).
 */
exports.CAPTURE_TIMEOUT_MS = 20_000;
/** The tab to picture: the first real web page. /json lists the most recently used tab first. */
function pickPreviewTab(tabs) {
    return tabs.find(t => /^https?:\/\//i.test(t.url));
}
async function captureTab(port, tab, now = Date.now) {
    const session = await (0, cdpClient_1.openPageSession)(port, tab.id, exports.CAPTURE_TIMEOUT_MS);
    try {
        const metrics = await session.send('Page.getLayoutMetrics');
        const vw = Math.max(1, Math.round(metrics.cssVisualViewport?.clientWidth || 1280));
        const vh = Math.max(1, Math.round(metrics.cssVisualViewport?.clientHeight || 800));
        const scale = Math.min(1, exports.THUMB_WIDTH / vw);
        const shot = await session.send('Page.captureScreenshot', {
            format: 'jpeg', quality: QUALITY, optimizeForSpeed: true,
            clip: { x: 0, y: 0, width: vw, height: vh, scale },
        });
        if (typeof shot.data !== 'string' || !shot.data)
            throw new Error('The browser returned no image.');
        return { jpeg: shot.data, title: tab.title, url: tab.url, at: now() };
    }
    finally {
        session.close();
    }
}
//# sourceMappingURL=browserCapture.js.map