import * as net from 'net';

// Dev servers bind 127.0.0.1, ::1 or both (vite on Node 17+ often binds ::1 only),
// so a port answers when either loopback address accepts a connection.
function connects(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** True when something accepts a TCP connection on `port` at loopback right now. */
export async function portAnswers(port: number): Promise<boolean> {
  const tries = await Promise.all([connects(port, '127.0.0.1', 800), connects(port, '::1', 800)]);
  return tries.some(Boolean);
}

/** Polls until the port answers. Resolves false on timeout or when `cancelled()` turns true. */
export async function waitForPort(
  port: number,
  { timeoutMs = 60000, intervalMs = 500, cancelled = () => false }: { timeoutMs?: number; intervalMs?: number; cancelled?: () => boolean } = {}
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !cancelled()) {
    if (await portAnswers(port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
