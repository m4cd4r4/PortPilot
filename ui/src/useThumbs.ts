import { useCallback, useEffect, useRef, useState } from 'react';
import type { Host, ThumbRef } from './host';

export interface Thumb { url: string; at: number; live: boolean }
export interface Thumbs {
  byApp: Record<string, Thumb>;
  /** Ask for a fresh capture of a running app; the host decides whether to honour it. */
  capture(appId: string, port: number): Promise<boolean>;
}

/**
 * Keeps one screenshot per app: polls the cheap index, fetches pixels only for keys not seen
 * before, and refreshes straight after a capture. Pixels live in a ref so a re-render never refetches.
 */
export function useThumbs(host: Host, pollMs = 4000): Thumbs {
  const [byApp, setByApp] = useState<Record<string, Thumb>>({});
  const pixels = useRef(new Map<string, string>());
  const alive = useRef(true);

  const sync = useCallback(async () => {
    try {
      const index: Record<string, ThumbRef> = await host.thumbIndex();
      const missing = [...new Set(Object.values(index).map((t) => t.key))].filter((k) => !pixels.current.has(k));
      for (let i = 0; i < missing.length; i += 40) {
        const got = await host.thumbs(missing.slice(i, i + 40));
        for (const [k, v] of Object.entries(got)) pixels.current.set(k, v);
      }
      if (!alive.current) return;
      const next: Record<string, Thumb> = {};
      for (const [appId, t] of Object.entries(index)) {
        const url = pixels.current.get(t.key);
        if (url) next[appId] = { url, at: t.at, live: t.live };
      }
      // Drop pixels no app points at any more.
      const keep = new Set(Object.values(index).map((t) => t.key));
      for (const k of pixels.current.keys()) if (!keep.has(k)) pixels.current.delete(k);
      setByApp(next);
    } catch { /* the index is a nicety; the cards still render without it */ }
  }, [host]);

  useEffect(() => {
    alive.current = true;
    sync();
    const t = setInterval(sync, pollMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [sync, pollMs]);

  const capture = useCallback(async (appId: string, port: number) => {
    const r = await host.captureThumb(appId, port);
    if (r.ok) await sync();
    return r.ok;
  }, [host, sync]);

  return { byApp, capture };
}
