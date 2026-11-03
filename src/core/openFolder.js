/**
 * Which directory does "Open folder" open for an app cwd or a process exe path?
 *
 * Incident (code review, 2026-11-02): the renderer sent a file:/// URL through
 * shell:openExternal, which allows only http/https and answers {success:false} without
 * throwing, so nothing opened while the toast said "Opened folder". Folders go through
 * shell.openPath with a real directory, resolved here.
 */
const fs = require('fs');
const path = require('path');

/** The directory to open: the path itself when it is a directory, its parent when it is a file, else null. */
function folderToOpen(target, statSync = fs.statSync) {
  const p = String(target || '').trim().replace(/^["']|["']$/g, '');
  if (!p || /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return null; // not a URL
  // Absolute local paths only: a UNC path (\\host\share) would open an SMB connection just to
  // stat it, and a relative one would resolve against the app's own cwd.
  if (/^[\\/]{2}/.test(p) || !path.isAbsolute(p)) return null;
  const abs = path.resolve(p);
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return abs;
    if (st.isFile()) return path.dirname(abs);
  } catch { /* missing: fall through */ }
  return null;
}

module.exports = { folderToOpen };
