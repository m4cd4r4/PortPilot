import type { ButtonHTMLAttributes } from 'react';

/** Inline 24px stroke icons. Names that are drawn filled sit in FILLED. */
const PATHS = {
  stop: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  start: 'M8 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 8 5.5z',
  edit: 'M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  details: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  kill: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  release: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.6-1.8',
  again: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5',
  close: 'M6 6l12 12M18 6L6 18',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
} as const;

export type IconName = keyof typeof PATHS;
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['stop', 'start']);

export function Icon({ name, filled }: { name: IconName; filled?: boolean }) {
  const fill = filled ?? FILLED.has(name);
  return (
    <svg className="ic" width="14" height="14" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
  );
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  icon: IconName;
  /** The accessible name and tooltip. Keep it the word the button used to show, so tests and screen readers still find it. */
  label: string;
  /** Longer tooltip, e.g. "Stop shop". Defaults to label. */
  tip?: string;
  /** Draw the icon filled (a set star). */
  filled?: boolean;
  /** Shows a spinner-free busy state: the button is disabled and marked aria-busy. */
  busy?: boolean;
};

/** A square icon button for actions that repeat on every row or card. Confirm and form buttons keep their words. */
export function IconButton({ icon, label, tip, filled, busy, className, disabled, ...rest }: Props) {
  return (
    <button type="button" {...rest} className={`ib${className ? ` ${className}` : ''}`} aria-label={label} title={tip ?? label}
      disabled={disabled || busy} aria-busy={busy || undefined}>
      <Icon name={icon} filled={filled} />
    </button>
  );
}
