/**
 * Brand art for a browser profile card: pick the best picture a site offers for itself.
 *
 * Pure decisions only (no network, no disk): which page to read, which image URLs it offers in
 * which order, which URLs are safe to fetch, and whether bytes really are a small raster image.
 * The fetching lives in src/main/browserExtraIpc.js. Zero dependencies.
 *
 * SVG is refused on purpose: it can carry script, and a card only needs a picture.
 */

const PAGE_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** True for a hostname that is a real public name: not localhost, an IP, or a single label. */
function isPublicHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || h.includes(':') || h.startsWith('[')) return false; // IPv6 literal or a port
  if (IPV4_RE.test(h)) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  return h.includes('.');
}

/** A URL object when `value` is an http(s) URL on a public host, else null. */
function publicHttpUrl(value) {
  let u;
  try { u = new URL(String(value)); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return isPublicHost(u.hostname) ? u : null;
}

/**
 * The page to read for a profile: its start url when that is public http(s), else the first site.
 * Null when the profile names nothing public (a localhost or about:blank profile has no brand art).
 */
function pageUrlFor(profile) {
  const p = profile || {};
  const fromUrl = publicHttpUrl(p.url);
  if (fromUrl) return fromUrl.href;
  for (const site of Array.isArray(p.sites) ? p.sites : []) {
    const u = publicHttpUrl(`https://${site}/`);
    if (u) return u.href;
  }
  return null;
}

const attrOf = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
};

const decodeEntities = (s) => s.replace(/&amp;/gi, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

/** Largest edge declared by a sizes="180x180" attribute; 0 when absent or "any". */
function sizeOf(sizes) {
  const m = /(\d+)x(\d+)/i.exec(String(sizes || ''));
  return m ? Math.max(Number(m[1]), Number(m[2])) : 0;
}

/**
 * Image URLs the page offers, best first, as [{ url, kind }] with kind 'og' | 'icon'. Social
 * preview images come first (wide, branded), then touch icons by declared size, then plain icons,
 * then /favicon.ico. Every URL is resolved against the page and must be public http(s).
 * @param {string} html  the page (only the head is needed)
 * @param {string} pageUrl  where the html came from
 */
function artCandidates(html, pageUrl) {
  const base = publicHttpUrl(pageUrl);
  if (!base) return [];
  const head = String(html || '').slice(0, PAGE_MAX_BYTES);
  const og = [];
  const icons = [];
  for (const tag of head.match(/<(?:meta|link)\b[^>]*>/gi) || []) {
    const isMeta = /^<meta/i.test(tag);
    if (isMeta) {
      const key = (attrOf(tag, 'property') || attrOf(tag, 'name')).toLowerCase();
      if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url' || key === 'twitter:image' || key === 'twitter:image:src') {
        og.push({ raw: attrOf(tag, 'content'), rank: key.startsWith('og:') ? 0 : 1 });
      }
    } else {
      const rel = attrOf(tag, 'rel').toLowerCase().split(/\s+/);
      if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
        icons.push({ raw: attrOf(tag, 'href'), rank: 0, size: sizeOf(attrOf(tag, 'sizes')) });
      } else if (rel.includes('icon')) {
        icons.push({ raw: attrOf(tag, 'href'), rank: 1, size: sizeOf(attrOf(tag, 'sizes')) });
      }
    }
  }
  const out = [];
  const seen = new Set();
  const add = (raw, kind) => {
    if (!raw) return;
    let u;
    try { u = new URL(decodeEntities(raw), base); } catch { return; }
    if (!publicHttpUrl(u.href) || seen.has(u.href)) return;
    seen.add(u.href);
    out.push({ url: u.href, kind });
  };
  og.sort((a, b) => a.rank - b.rank).forEach((c) => add(c.raw, 'og'));
  icons.sort((a, b) => a.rank - b.rank || b.size - a.size).forEach((c) => add(c.raw, 'icon'));
  add('/favicon.ico', 'icon');
  return out;
}

/** The image type of `buf` from its first bytes: png, jpeg, webp, gif, ico; null for anything else. */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.toString('ascii', 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return { mime: 'image/x-icon', ext: 'ico' };
  return null;
}

module.exports = { PAGE_MAX_BYTES, IMAGE_MAX_BYTES, isPublicHost, publicHttpUrl, pageUrlFor, artCandidates, sniffImage };
