export interface PollEnv {
  visible(): boolean;
  /** Calls back whenever visible() may have changed; returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

// The desktop window says when it is minimised or hidden to the tray: the page itself can go on
// reporting "visible" there. In a plain browser tab only the page's own visibility counts.
let shown = true;
const subs = new Set<() => void>();
let wired = false;
function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  const tell = () => { for (const cb of [...subs]) cb(); };
  document.addEventListener('visibilitychange', tell);
  const api = (window as unknown as { portpilot?: { on?: (ch: string, cb: (v: unknown) => void) => void } }).portpilot;
  api?.on?.('window-shown', (v) => { shown = v !== false; tell(); });
}

const pageEnv: PollEnv = {
  visible: () => shown && (typeof document === 'undefined' || document.visibilityState === 'visible'),
  onChange: (cb) => { wire(); subs.add(cb); return () => { subs.delete(cb); }; },
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/**
 * setInterval for screen data: runs `fn` every `ms` only while the window can be seen. A hidden
 * window holds no timer at all. When it is shown again `fn` runs once at once, so the screen is
 * never older than one read, then the interval resumes. Returns the stop function.
 */
export function every(fn: () => void, ms: number, env: PollEnv = pageEnv): () => void {
  let timer: unknown = null;
  const start = () => { if (timer == null) timer = env.setInterval(fn, ms); };
  const stop = () => { if (timer != null) { env.clearInterval(timer); timer = null; } };
  const off = env.onChange(() => {
    if (!env.visible()) { stop(); return; }
    if (timer == null) { fn(); start(); }
  });
  if (env.visible()) start();
  return () => { stop(); off(); };
}
