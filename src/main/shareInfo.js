/**
 * Build shareable URLs for a locally running app: the loopback URL, the
 * LAN URL (so another device on the same network can reach it), and a QR
 * code of the LAN URL for phones. The QR is a data: URL so it can be shown
 * with a plain <img> under the app's strict CSP (img-src 'self' data:).
 */
const os = require('os');
const QRCode = require('qrcode');

// Interface names that are virtual adapters (WSL, VirtualBox, VMware, Hyper-V,
// Docker) - their IPs are not reachable from a phone on the real LAN, so they
// rank last.
const VIRTUAL_RE = /vethernet|virtualbox|vmware|hyper-v|docker|loopback|vbox|wsl/i;

/**
 * Best non-internal IPv4 address for LAN sharing, or null if the host is
 * offline. Prefers real adapters and common private LAN ranges over virtual
 * adapters (WSL/VirtualBox/etc.) so the QR/LAN URL actually reaches a phone.
 */
function lanAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const virtual = VIRTUAL_RE.test(name);
      const homeLan = /^192\.168\./.test(net.address);
      const privateLan = homeLan || /^10\./.test(net.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(net.address);
      // Lower score = preferred.
      const score = (virtual ? 100 : 0) + (privateLan ? 0 : 10) + (homeLan ? 0 : 1);
      candidates.push({ address: net.address, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.length ? candidates[0].address : null;
}

/**
 * @param {number} port
 * @returns {Promise<{success:boolean, localUrl?:string, lanUrl?:string, lanAddress?:string, qrDataUrl?:string, error?:string}>}
 */
async function shareInfo(port) {
  const p = parseInt(port, 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return { success: false, error: 'Invalid port' };
  const ip = lanAddress();
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
