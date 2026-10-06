# Status vocabulary

The canonical words, glyphs and tokens every PortPilot surface (desktop, web portal,
VS Code, MCP, the Claude Code plugin) uses for an app's state and for who started it.
The code source of truth is [src/core/status.js](../../src/core/status.js);
`tests/status-provenance.test.cjs` fails if this file and `STATES` drift apart.

## Runtime state

Each state has its own shape as well as its own colour, so it reads in greyscale, under colour-blind
vision and in every theme. Use `ascii` where the glyph cannot be drawn (plain
terminals, log lines).

| State | Glyph | ASCII | Word | Token | Meaning |
|---|---|---|---|---|---|
| `running` | ● | `*` | Running | `--status-running` | Process is up and its port is bound. |
| `stopped` | ○ | `o` | Stopped | `--status-stopped` | Not running. The resting state. |
| `starting` | ◐ | `~` | Starting | `--status-starting` | Launched, port not bound yet. |
| `conflict` | ▲ | `!` | Conflict | `--status-conflict` | Its preferred port is held by something else. |
| `error` | ⊗ | `x` | Error | `--status-error` | Alive but unhealthy (health check failing). |
| `crashed` | ✕ | `X` | Crashed | `--status-crashed` | Dead after an unexpected exit. |

When several flags are true, the highest wins:
`crashed > error > conflict > starting > running > stopped`.

The `--status-crashed` CSS token is not defined in any theme yet. It lands with the
row-state work (PROJECT-PLAN row 8), the first place a crashed row renders.

## Provenance: who started it

Stored per app in `portpilot-runtime.json`, next to the config file, as
`{ startedBy, pid, port }`. It is runtime state, so it never rides along in a config
export or import. Each surface stamps it on a successful start and clears it on a
successful stop. Writes are best-effort: a failed stamp never fails the start.

`startedBy` is `{ kind, surface, sessionId?, label?, at }`, built with
`makeStartedBy()`, which rejects an unknown `kind` or `surface`.

| Kind | Word shown | Glyph | Stamped by |
|---|---|---|---|
| `human` | you | none | desktop app, web portal, VS Code |
| `claude` | claude a3f2 | ✦ | MCP `start_app` / `bulk_start` |
| `external` | external | none | nobody: found running, no record |

- The word is what every surface shows. The ✦ glyph is for tight spaces and is never
  shown alone.
- `a3f2` is the first four alphanumerics of `sessionId`. The full id goes in the
  tooltip/title, as does the surface and the start time.
- Claude with no `sessionId` reads as plain `claude`.
- Surfaces: `desktop`, `web`, `vscode`, `claude-code`, `mcp`.

The session id reaches the record through the optional `sessionId` argument on the
MCP `start_app` and `bulk_start` tools. The Claude Code plugin (Wave 2) passes it.
