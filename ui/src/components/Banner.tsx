interface Props { warnings: string[]; onFix: () => void }

/** One slim amber line, never red blocks. Every warning is a port conflict, so Fix opens Ports, where each blocked app has a Free button. */
export function Banner({ warnings, onFix }: Props) {
  if (!warnings.length) return null;
  const more = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : '';
  return (
    <div className="banner" role="status">
      <span className="dot warn" aria-hidden="true" />
      <span className="msg">{warnings[0]}{more}</span>
      <button onClick={onFix}>Fix</button>
    </div>
  );
}
