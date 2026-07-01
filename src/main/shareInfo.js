/**
 * Build shareable URLs for a locally running app: the loopback URL, the
 * LAN URL (so another device on the same network can reach it), and a QR
 * code of the LAN URL for phones. The QR is a data: URL so it can be shown
 * with a plain <img> under the app's strict CSP (img-src 'self' data:).
 */
const os = require('os');
const dgram = require('dgram');
const QRCode = require('qrcode');

// VirtualBox's default host-only network. Docker Desktop's default NAT range.
// Both can appear as ordinary-looking 192.168.x adapters, so they need an
// explicit blacklist rather than relying on interface naming (which varies -
// e.g. VirtualBox often shows up as a generic "Ethernet 2", not "VirtualBox...").
const KNOWN_VIRTUAL_SUBNETS = [/^192\.168\.56\./, /^172\.17\./];
const VIRTUAL_NAME_RE = /vethernet|virtualbox|vmware|hyper-v|docker|loopback|vbox|wsl/i;

/**
 * Ask the OS routing table which local address it would use to reach the
 * outside world, by connecting a UDP socket (no packets are actually sent -
 * UDP "connect" only resolves a route). This is far more reliable than
 * guessing from interface names/ranges, since it reflects the OS's own
 * default-route choice - the same adapter a phone on the LAN would reach.
 * Resolves null if there's no route at all (fully offline, no adapters).
 */
function routedAddress() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const sock = dgram.createSocket('udp4');
      sock.once('error', () => { try { sock.close(); } catch { /* ignore */ } done(null); });
      sock.connect(80, '8.8.8.8', () => {
        let address = null;
        try { address = sock.address().address; } catch { /* ignore */ }
        try { sock.close(); } catch { /* ignore */ }
        done(address && address !== '0.0.0.0' ? address : null);
      });
    } catch { done(null); }
  });
}

/** Fallback when there's no default route: best-guess from interface list. */
function heuristicAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const virtual = VIRTUAL_NAME_RE.test(name) || KNOWN_VIRTUAL_SUBNETS.some((re) => re.test(net.address));
      const privateLan = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address);
      const score = (virtual ? 100 : 0) + (privateLan ? 0 : 10);
      candidates.push({ address: net.address, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.length ? candidates[0].address : null;
}

/** Best IPv4 address for LAN sharing, or null if the host is offline. */
async function lanAddress() {
  const routed = await routedAddress();
  if (routed && !KNOWN_VIRTUAL_SUBNETS.some((re) => re.test(routed))) return routed;
  return heuristicAddress();
}

/**
 * @param {number} port
 * @returns {Promise<{success:boolean, localUrl?:string, lanUrl?:string, lanAddress?:string, qrDataUrl?:string, error?:string}>}
 */
async function shareInfo(port) {
  const p = parseInt(port, 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return { success: false, error: 'Invalid port' };
  const ip = await lanAddress();
  const localUrl = `http://localhost:${p}`;
  const lanUrl = ip ? `http://${ip}:${p}` : null;
  let qrDataUrl = null;
  if (lanUrl) {
    try { qrDataUrl = await QRCode.toDataURL(lanUrl, { margin: 1, width: 220 }); }
    catch { /* QR is best-effort */ }
  }
  return { success: true, localUrl, lanUrl, lanAddress: ip, qrDataUrl };
}

module.exports = { shareInfo, lanAddress };
