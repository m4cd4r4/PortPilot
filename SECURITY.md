# PortPilot Security Model

This document describes the threat model for the **PortPilot Web Agent** (v3) —
the loopback HTTP server that exposes PortPilot's backend to a browser UI
(`npm run agent`). The desktop (Electron) app does **not** open a network port
and is not covered by the network threat model below.

## Why this needs a serious threat model

PortPilot's backend can **start and kill processes** by running user-configured
shell commands. That makes it remote-code-execution **by design**: anything that
can reach the API and authenticate can run arbitrary code as the user. The web
agent therefore treats its API as a high-value target.

The key risk a browser introduces is that **any website you have open can try to
reach `http://localhost`**. The agent defends against this with several
independent layers — no single one is relied upon.

## Defence layers

| # | Control | Threat it stops | Where |
|---|---------|-----------------|-------|
| 1 | **Bind to `127.0.0.1` only** | Remote/LAN attackers — the port is unreachable off-box | `server.listen(PORT, '127.0.0.1')` |
| 2 | **Per-session 256-bit token** | CSRF: a cross-origin `fetch` still fires, but is rejected without the token, which the attacker cannot read (SOP) or guess | `crypto.randomBytes(32)`, `tokenOk()` (constant-time) |
| 3 | **Host-header allowlist** | **DNS rebinding** — `evil.com` re-resolving to `127.0.0.1` arrives with `Host: evil.com` and is rejected before any handler runs | `hostOk()` |
| 4 | **Origin allowlist + locked CORS** | Cross-origin browser calls — CORS reflects only the agent's own origin, never `*` | `originOk()`, `setSecurityHeaders()` |
| 5 | **Custom header forces preflight** | "Simple request" CSRF — `X-PortPilot-Token` makes every `/api` call non-simple, so the browser sends a CORS preflight that a foreign origin fails | `portpilot-web.js`, OPTIONS handler |
| 6 | **Strict CSP on the served UI** | XSS → code-exec and data exfiltration — `script-src 'self'` (no `'unsafe-inline'`; all UI actions use delegated `data-act` handlers), `connect-src 'self'`, `default-src 'self'` block inline scripts, remote scripts, and non-loopback fetches | CSP meta in `index.html` |
| 7 | **Per-user token file** | Other local users reading the token: `agent.json` lives in your per-user config dir, whose OS permissions deny other users (`chmod 600` is additionally applied on POSIX) | `writeAgentFile()` |
| 8 | **1 MB request cap + path-traversal guard** | Memory-exhaustion and `../` file reads | request handler, `serveStatic()` |

The token is the linchpin (layer 2): a cross-origin page can neither **read** it
(same-origin policy on the agent-served page) nor **guess** it (256 bits of
entropy). Layers 3–5 are defence-in-depth so that even a token-less attacker is
blocked at the network/CORS level.

### Why a token, when the desktop app has none?

The Electron app exposes the backend over an **internal IPC bridge with no
listening socket** — no browser tab can reach it. The web agent trades that for a
loopback HTTP port (so a normal browser can connect), and the layers above close
exactly that new seam. Net exposure is intended to be equivalent, not worse.

## Verified behaviour

Probed against a running agent (`npm run agent`):

| Request | Result |
|---------|--------|
| `GET /` with `Host: evil.com` (rebinding sim) | `403` |
| `GET /` with correct Host | `200`, token injected as `<meta>` |
| `POST /api` without token | `401` |
| `POST /api` with foreign `Origin` | `403` |
| `POST /api` with valid token + origin | `200` JSON |
| `GET /../../package.json` (traversal) | blocked |
| `agent.json` file mode (POSIX) | `600` |

## Known limitations

- **The token grants full control.** If it leaks (e.g. shoulder-surfing the
  printed URL, or a malicious process reading `agent.json`), an attacker has the
  same power as the user. This mirrors the desktop app's existing exposure.
- **Token-file permissions are user-scoped, not chmod-enforced on Windows.**
  `agent.json` is written with mode `0o600`, which protects it on Linux/macOS. On
  Windows the POSIX mode bits are largely ignored; what actually blocks *other*
  local users is the default per-user ACL on `%APPDATA%`. In every case, any
  process already running as **you** can read the token - the same trust boundary
  as your own files.
- **SSE token in the URL.** Live updates use `EventSource`, which cannot set
  headers, so the token rides in the `/events?token=...` query string (still
  Host + Origin + token checked). On pure loopback with no proxy this is low-risk,
  but query-string tokens can surface in logs.
- **No TLS.** Loopback (`127.0.0.1`) is treated as a secure context by browsers,
  so TLS is omitted; traffic never leaves the machine. A self-signed cert could
  be added if desired.
- **`style-src 'unsafe-inline'`.** The UI uses a few inline `style=` attributes
  (e.g. group colour dots), so inline *styles* are still permitted. Inline
  *scripts* are not (`script-src 'self'`), which is the security-relevant case.
- **One backend at a time.** Apps started by the agent and apps started by the
  desktop app are tracked in separate process tables. Run one or the other.

## MCP server in HTTP mode

While the desktop app runs it also serves the MCP server over HTTP at
`http://127.0.0.1:8788/mcp` (override with `PORTPILOT_MCP_PORT`). It binds to
loopback only and refuses any request whose `Host` is not `127.0.0.1:<port>` or
`localhost:<port>`, or that carries an `Origin` other than those two. That closes
DNS rebinding and cross-site browser calls; MCP clients such as Claude Code send
no `Origin` and pass. There is no token: any process running as you can reach it,
the same trust boundary as the config file it edits. Before v3.3.1 these checks
were missing. Test: `node tests/mcp-http-guard.test.mjs`.

## Reporting

Found an issue? Please open a GitHub issue (or a private report for anything
exploitable) at https://github.com/m4cd4r4/PortPilot/issues.
