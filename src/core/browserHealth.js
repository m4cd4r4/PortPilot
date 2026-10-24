/**
 * Sign-in health for a RUNNING browser profile, from the cookies its browser holds.
 *
 * Pure: takes the cookie list CDP's Storage.getCookies returns and the profile's hosts. The CDP
 * call itself is in src/main/browserExtraIpc.js. Values are never read, only names, domains and
 * expiry, and nothing here leaves the machine.
 *
 * States: 'in' (a login-looking cookie for the profile's site is present and alive), 'out' (none),
 * 'unknown' (profile not running, or nothing to check against). There is no 'expired': a running
 * browser has already dropped expired cookies, so an expired login looks the same as a signed-out one.
 */

// Names that sites use for the cookie that proves a login. Deliberately a short list: a tracking
// cookie must not make a signed-out profile look signed in.
const AUTH_NAME_RE = /(?:^|[_.-])(?:sess(?:ion)?(?:id)?|auth|token|sid|ssid|login|logged_?in|jwt|access_token|id_token)(?:$|[_.-])|^(?:c_user|xs|li_at|sapisid|__secure-[13]psid|connect\.sid|sessionid|_session_id|laravel_session|phpsessid|jsessionid)$/i;

const lower = (s) => String(s || '').toLowerCase();

/** Does a cookie scoped to `domain` get sent to `host`? (".example.com" covers "www.example.com") */
function domainCoversHost(domain, host) {
  const d = lower(domain).replace(/^\./, '');
  const h = lower(host);
  return !!d && !!h && (h === d || h.endsWith(`.${d}`));
}

/** The hostnames to check a profile against: its sites, then the host of its start url. */
function hostsFor(profile) {
  const p = profile || {};
  const hosts = [...(Array.isArray(p.sites) ? p.sites : [])];
  try {
    const u = new URL(String(p.url || ''));
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) hosts.push(u.hostname);
  } catch { /* no usable url */ }
  return [...new Set(hosts.map(lower).filter(Boolean))];
}

/** True for a session cookie or one whose expiry (unix seconds) is still ahead. */
const alive = (cookie, nowSec) => !(Number.isFinite(cookie.expires) && cookie.expires > 0) || cookie.expires > nowSec;

/**
 * @param {{name:string, domain:string, expires?:number}[]} cookies  CDP cookies
 * @param {string[]} hosts  from hostsFor()
 * @param {number} [nowSec]
 * @returns {'in'|'out'|'unknown'}
 */
function signInState(cookies, hosts, nowSec = Date.now() / 1000) {
  if (!Array.isArray(cookies) || !hosts || !hosts.length) return 'unknown';
  const hit = cookies.some((c) => c && typeof c.name === 'string'
    && AUTH_NAME_RE.test(c.name)
    && alive(c, nowSec)
    && hosts.some((h) => domainCoversHost(c.domain, h) || domainCoversHost(h, c.domain)));
  return hit ? 'in' : 'out';
}

module.exports = { AUTH_NAME_RE, domainCoversHost, hostsFor, signInState };
