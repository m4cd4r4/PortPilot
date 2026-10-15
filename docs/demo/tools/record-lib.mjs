// Shared helpers for the animation scripts: capture frames of a page while it is driven, show a cursor and a
// caption in the frames, and encode the frames to a looping animated WebP with ffmpeg.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

export const mediaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'media');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OVERLAY_CSS = `
#pp-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:99999;pointer-events:none;transition:transform .55s cubic-bezier(.3,.1,.2,1);transform:translate(-40px,-40px)}
#pp-cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))}
#pp-ripple{position:fixed;z-index:99998;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #7aa2f7;opacity:0;transform:scale(.3)}
#pp-ripple.go{animation:pp-r .45s ease-out}
@keyframes pp-r{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(1.5)}}
#pp-caption{position:fixed;left:16px;bottom:16px;z-index:99997;max-width:48%;padding:9px 16px;border-radius:9px;background:rgba(22,22,30,.94);border:1px solid #3b4261;color:#c0caf5;font:600 15px 'Segoe UI',sans-serif;text-align:left;box-shadow:0 8px 24px rgba(0,0,0,.45);transition:opacity .2s}
#pp-caption b{color:#7dcfff;font-family:Consolas,monospace;font-weight:600}
`;

/** Add the cursor, click ripple and caption layer to a page. Call after navigation. */
export async function addOverlay(page) {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.id = 'pp-cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6 1.6L8.6 18z" fill="#fff" stroke="#1a1b26" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const r = document.createElement('div'); r.id = 'pp-ripple';
    const cap = document.createElement('div'); cap.id = 'pp-caption'; cap.style.opacity = '0';
    document.body.append(c, r, cap);
  });
}

export const caption = (page, html) => page.evaluate((h) => {
  const el = document.getElementById('pp-caption');
  el.innerHTML = h; el.style.opacity = h ? '1' : '0';
}, html);

/** Glide the cursor onto an element, ripple, then really click it. */
export async function clickWithCursor(page, selector, { pause = 250 } = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('no box for ' + selector);
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await page.evaluate(([x, y]) => { document.getElementById('pp-cursor').style.transform = `translate(${x - 4}px,${y - 3}px)`; }, [x, y]);
  await sleep(650 + pause);
  await page.evaluate(([x, y]) => { const r = document.getElementById('pp-ripple'); r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }, [x, y]);
  await page.locator(selector).first().click();
}

/** Capture frames in the background until stop() is called. Frames keep their real timing. */
export function startRecording(page, { clip, quality = 78 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir().replace(/\\/g, '/'), 'ppclip-'));
  const frames = [];
  let live = true;
  const loop = (async () => {
    let i = 0;
    while (live) {
      const t = Date.now();
      const file = path.join(dir, `f${String(i++).padStart(5, '0')}.jpg`);
      try { await page.screenshot({ path: file, type: 'jpeg', quality, ...(clip ? { clip } : {}) }); } catch { break; }
      frames.push({ file, t });
    }
  })();
  return {
    dir, frames,
    async stop() { live = false; await loop; return { dir, frames }; },
  };
}

/** Encode captured frames to a looping animated WebP, width in px. The last frame holds for `tail` ms. */
export function encodeWebp({ dir, frames }, outFile, { width = 880, fps = 12, tail = 1400, quality = 55 } = {}) {
  if (frames.length < 2) throw new Error('too few frames: ' + frames.length);
  const lines = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    const dur = next ? Math.max(0.02, (next.t - f.t) / 1000) : tail / 1000;
    lines.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${dur.toFixed(3)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, lines.join('\n'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`, '-c:v', 'libwebp_anim', '-quality', '80', '-q:v', String(quality), '-loop', '0', '-an', outFile], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || r.error));
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  return { frames: frames.length, kb };
}
