import { useEffect, useState } from 'react';
import type { Host, Settings as S } from '../host';

interface Props { host: Host; onClassic: () => Promise<void> }

type BoolKey = 'autoScan' | 'closeToTray' | 'stopAppsOnQuit' | 'openAtLogin' | 'autoResizeWindow' | 'notifyOnCrash'
  | 'autoTrackLocalhost' | 'autoRegister' | 'openDevTools' | 'historySnapshots' | 'rowPreviews';

const TOGGLES: Array<{ title: string; rows: Array<{ key: BoolKey; label: string; hint: string; fallback: boolean }> }> = [
  { title: 'Window', rows: [
    { key: 'closeToTray', label: 'Close button hides to the tray', hint: 'Off: closing the window quits PortPilot.', fallback: true },
    { key: 'openAtLogin', label: 'Start PortPilot at login', hint: 'Keeps the shared MCP server up. Applies to the installed app only.', fallback: true },
    { key: 'autoResizeWindow', label: 'Resize the window to the app count', hint: 'Off by default; it fights manual resizing.', fallback: false },
  ] },
  { title: 'Apps', rows: [
    { key: 'stopAppsOnQuit', label: 'Stop PortPilot-started apps on quit', hint: 'Apps started elsewhere are never touched.', fallback: true },
    { key: 'notifyOnCrash', label: 'Tell me when an app exits unexpectedly', hint: 'A toast, plus an OS notification when the window is hidden.', fallback: true },
    { key: 'autoRegister', label: 'Register apps I start from a terminal', hint: 'Adds a localhost server to the Library the first time it is seen.', fallback: false },
  ] },
  { title: 'Scanning and history', rows: [
    { key: 'autoScan', label: 'Scan ports in the background', hint: 'Off: only the Rescan button reads the machine.', fallback: true },
    { key: 'autoTrackLocalhost', label: 'Record every localhost server in History', hint: 'Whoever started it.', fallback: true },
    { key: 'historySnapshots', label: 'Keep a page screenshot with each run', hint: 'Stored on this machine only.', fallback: true },
    { key: 'rowPreviews', label: 'Show live previews on rows', hint: 'Classic view only; the new view always shows thumbnails.', fallback: true },
  ] },
  { title: 'Developer', rows: [
    { key: 'openDevTools', label: 'Open DevTools with the window', hint: 'For debugging PortPilot itself.', fallback: false },
  ] },
];

const THEMES = [{ v: 'dark', l: 'Dark' }, { v: 'light', l: 'Light' }, { v: 'system', l: 'System' }];

const THEME_KEY = 'portpilot-ui-theme';

/** The new view keeps its own theme choice (the classic view stores its palette names elsewhere). */
export function applyTheme(theme: string | null) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function loadTheme(): string {
  try { const v = localStorage.getItem(THEME_KEY); if (v === 'dark' || v === 'light') return v; } catch { /* storage can be unavailable */ }
  return 'system';
}

export function Settings({ host, onClassic }: Props) {
  const [s, setS] = useState<S | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    host.getSettings().then(setS).catch((e) => setError((e as Error).message));
  }, [host]);

  const save = async (patch: S, label: string) => {
    setError('');
    const before = s;
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    try {
      const next = await host.updateSettings(patch);
      setS(next);
      setSaved(`${label} saved`);
    } catch (e) { setS(before); setError((e as Error).message); setSaved(''); }
  };

  const pickTheme = (v: string) => {
    setTheme(v);
    try { if (v === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch { /* ignore */ }
    applyTheme(v === 'system' ? null : v);
    setSaved('Theme saved');
  };

  if (!s) return <section className="settings-view" aria-label="Settings">{error ? <p className="notice" role="alert">{error}</p> : <p className="empty-note">Loading settings</p>}</section>;

  const scanSeconds = Math.round((s.scanInterval ?? 5000) / 1000);

  return (
    <section className="settings-view" aria-label="Settings">
      <div className="toolbar"><h2 className="view-h">Settings</h2><span className="saved" role="status">{saved}</span></div>
      {error && <p className="notice" role="alert">{error}</p>}

      <fieldset className="set-group">
        <legend>Appearance</legend>
        <div className="seg small" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.v} aria-pressed={theme === t.v} className={theme === t.v ? 'on' : ''}
              onClick={() => pickTheme(t.v)}>{t.l}</button>
          ))}
        </div>
      </fieldset>

      {TOGGLES.map((g) => (
        <fieldset className="set-group" key={g.title}>
          <legend>{g.title}</legend>
          {g.rows.map((r) => {
            const on = s[r.key] ?? r.fallback;
            return (
              <label className="set-row" key={r.key}>
                <input type="checkbox" checked={on} onChange={(e) => save({ [r.key]: e.target.checked }, r.label)} />
                <span><strong>{r.label}</strong><small>{r.hint}</small></span>
              </label>
            );
          })}
        </fieldset>
      ))}

      <fieldset className="set-group">
        <legend>Limits</legend>
        <NumberRow label="Scan every (seconds)" value={scanSeconds} min={2} max={300}
          onSave={(n) => save({ scanInterval: n * 1000 }, 'Scan interval')} />
        <NumberRow label="History: most runs kept" value={s.historyMaxRuns ?? 1000} min={10} max={5000}
          onSave={(n) => save({ historyMaxRuns: n }, 'History size')} />
        <NumberRow label="History: screenshots up to (MB)" value={s.historyMaxMB ?? 150} min={10} max={5000}
          onSave={(n) => save({ historyMaxMB: n }, 'Screenshot budget')} />
      </fieldset>

      <fieldset className="set-group">
        <legend>Views</legend>
        <p className="set-note">You are in the new view. The classic view stays available until the web portal moves over.</p>
        <button onClick={() => onClassic().catch((e) => setError((e as Error).message))}>Switch to classic view</button>
      </fieldset>
    </section>
  );
}

/** Commits on blur or Enter so a half-typed number never reaches the config. */
function NumberRow({ label, value, min, max, onSave }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || n < min || n > max) { setText(String(value)); return; }
    if (n !== value) onSave(n);
  };
  return (
    <label className="set-row num">
      <input value={text} inputMode="numeric" aria-label={label} onChange={(e) => setText(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      <span><strong>{label}</strong><small>{min} to {max}</small></span>
    </label>
  );
}
