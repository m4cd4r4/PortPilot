/** Paints the native window buttons (Windows overlay title bar) to match the Ledger header they sit over. */
type Api = { setTitleBar?: (c: { color: string; symbolColor: string; height: number }) => Promise<unknown> };

const probe = (token: string): string => {
  const el = document.createElement('i');
  el.style.color = `var(${token})`;
  document.body.appendChild(el);
  const m = getComputedStyle(el).color.match(/[\d.]+/g) || [];
  el.remove();
  return `#${m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`;
};

/** Sends the colours and height now; the caller re-runs it when the theme, nav position or window size changes. */
export function syncTitleBar() {
  const api = (window as unknown as { portpilot?: { window?: Api } }).portpilot?.window;
  if (!api?.setTitleBar) return;
  requestAnimationFrame(() => {
    const top = document.querySelector('.topbar') as HTMLElement | null;
    const topShown = !!top && getComputedStyle(top).display !== 'none';
    const height = topShown ? Math.round(top!.getBoundingClientRect().height) : 32;
    api.setTitleBar!({ color: probe(topShown ? '--pn' : '--bg'), symbolColor: probe('--tx'), height: Math.min(96, Math.max(24, height)) }).catch(() => { /* not an overlay window */ });
  });
}
