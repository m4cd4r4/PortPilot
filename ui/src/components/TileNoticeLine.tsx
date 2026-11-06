import type { TileNotice } from '../tileRule';

/** A tile's failure or blocked reason, with "Go to Ports" when a held port is the cause. */
export function TileNoticeLine({ notice, onPorts, onClose }: { notice: TileNotice | null; onPorts?: () => void; onClose: () => void }) {
  if (!notice) return null;
  return (
    <p className="notice tile-notice" role="alert">
      <span>{notice.text}</span>
      {notice.ports && onPorts && <button className="link" onClick={onPorts}>Go to Ports</button>}
      <button className="link" onClick={onClose} aria-label="Dismiss">Dismiss</button>
    </p>
  );
}
