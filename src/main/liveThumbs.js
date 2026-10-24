/**
 * Live screenshots for the redesign's Localhost cards, kept in memory only.
 *
 * Wraps a capture function with the two limits the brief sets: one capture in flight at a
 * time, and at most one attempt per app per minGapMs (failures count, so a broken page is not
 * hammered). The newest image per app is held as a data URL and named by a key, so the UI can
 * ask for the cheap index every poll and fetch pixels only when a key changes.
 */
const MAX_ENTRIES = 300;
const KEY_RE = /^live-[A-Za-z0-9_.-]+-\d+$/;

function createLiveThumbs({ capture, now = Date.now, minGapMs = 10000 }) {
  const images = new Map();   // appId -> { key, at, url }
  const lastTry = new Map();  // appId -> ms of the last attempt
  let busy = false;

  /** @returns {Promise<{ok:true,key:string}|{ok:false,reason:'throttled'|'busy'|'failed',error?:string}>} */
  async function request(appId, port) {
    if (!/^[A-Za-z0-9_.-]+$/.test(String(appId))) return { ok: false, reason: 'failed', error: 'bad app id' };
    const t = now();
    if (t - (lastTry.get(appId) || -Infinity) < minGapMs) return { ok: false, reason: 'throttled' };
    if (busy) return { ok: false, reason: 'busy' };
    busy = true;
    lastTry.set(appId, t);
    try {
      const { jpeg } = await capture(port);
      const at = now();
      const key = `live-${appId}-${at}`;
      images.delete(appId);
      images.set(appId, { key, at, url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}` });
      while (images.size > MAX_ENTRIES) images.delete(images.keys().next().value);
      return { ok: true, key };
    } catch (err) {
      return { ok: false, reason: 'failed', error: err.message };
    } finally {
      busy = false;
    }
  }

  /** appId -> { key, at } for every live image held. */
  function index() {
    const out = {};
    for (const [appId, v] of images) out[appId] = { key: v.key, at: v.at };
    return out;
  }

  /** The data URL for a live key, or null once it has been replaced. */
  function get(key) {
    if (!KEY_RE.test(String(key))) return null;
    for (const v of images.values()) if (v.key === key) return v.url;
    return null;
  }

  return { request, index, get };
}

module.exports = { createLiveThumbs };
