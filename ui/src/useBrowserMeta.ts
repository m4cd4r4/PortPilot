import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArtRef, Host, Profile, SignIn } from './host';

export interface BrowserArt {
  /** profile name -> data URL of its picture */
  byName: Record<string, string>;
  /** Fetch the site's own picture again (a manual pick is kept). */
  refresh(name: string): Promise<boolean>;
  /** Open the file picker; resolves true when a picture was chosen. */
  choose(name: string): Promise<boolean>;
  clear(name: string): Promise<void>;
}

/**
 * One picture per browser profile. Polls the cheap index, fetches pixels only for a name+time not
 * seen before, and asks the host once per session to find a picture for each profile that has none
 * (the host remembers a miss for a day, so a restart does not refetch either).
 */
export function useBrowserArt(host: Host, profiles: Profile[], pollMs = 6000): BrowserArt {
  const [byName, setByName] = useState<Record<string, string>>({});
  const pixels = useRef(new Map<string, string>()); // "name@at" -> data URL
  const tried = useRef(new Set<string>());
  const alive = useRef(true);
  const index = useRef<Record<string, ArtRef>>({});

  const sync = useCallback(async () => {
    try {
      const idx = await host.browserArtIndex();
      index.current = idx;
      const key = (n: string) => `${n}@${idx[n].at}`;
      const missing = Object.keys(idx).filter((n) => !pixels.current.has(key(n)));
      for (let i = 0; i < missing.length; i += 20) {
        const batch = missing.slice(i, i + 20);
        const got = await host.browserArt(batch);
        for (const n of batch) if (got[n]) pixels.current.set(key(n), got[n]);
      }
      if (!alive.current) return;
      const next: Record<string, string> = {};
      const live = new Set<string>();
      for (const n of Object.keys(idx)) {
        const url = pixels.current.get(key(n));
        if (url) { next[n] = url; live.add(key(n)); }
      }
      for (const k of pixels.current.keys()) if (!live.has(k)) pixels.current.delete(k);
      setByName(next);
    } catch { /* art is a nicety; cards fall back to a gradient */ }
  }, [host]);

  useEffect(() => {
    alive.current = true;
    sync();
    const t = setInterval(sync, pollMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [sync, pollMs]);

  // Find art for profiles that have none, one at a time.
  const namesKey = profiles.map((p) => p.name).join('\n');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of profiles) {
        if (cancelled) return;
        if (index.current[p.name] || tried.current.has(p.name)) continue;
        tried.current.add(p.name);
        try { if (await host.refreshBrowserArt(p.name)) await sync(); } catch { /* offline: the card keeps its gradient */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, namesKey, sync]);

  const refresh = useCallback(async (name: string) => {
    const found = await host.refreshBrowserArt(name, true);
    await sync();
    return found;
  }, [host, sync]);
  const choose = useCallback(async (name: string) => {
    const picked = await host.chooseBrowserArt(name);
    if (picked) await sync();
    return picked;
  }, [host, sync]);
  const clear = useCallback(async (name: string) => {
    await host.clearBrowserArt(name);
    tried.current.add(name); // do not refetch what the user just cleared
    await sync();
  }, [host, sync]);

  return { byName, refresh, choose, clear };
}

/** Sign-in state of the running profiles, re-read every 20 s and whenever a profile starts or stops. */
export function useSignIns(host: Host, profiles: Profile[], pollMs = 20000): Record<string, SignIn> {
  const [state, setState] = useState<Record<string, SignIn>>({});
  const upKey = profiles.filter((p) => p.state === 'up').map((p) => p.name).sort().join('\n');

  useEffect(() => {
    const names = upKey ? upKey.split('\n') : [];
    let cancelled = false;
    const read = async () => {
      if (!names.length) { setState({}); return; }
      try {
        const got = await host.browserSignIns(names);
        if (!cancelled) setState(got);
      } catch { /* leave the last answer */ }
    };
    read();
    const t = setInterval(read, pollMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [host, upKey, pollMs]);

  return state;
}
