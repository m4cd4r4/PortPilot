/**
 * PortPilot mod: a status line of running dev servers, and a guard on Bash
 * dev-server starts.
 *
 * Status line (C1): `⚓ 3 up · :3000 web✦`, worst state first, `✦` on apps
 * Claude started. Refreshed at session start, every 15 s, and after a guarded
 * start.
 *
 * Guard (C3): a Bash command that starts a dev server
 *   - on a busy port is denied with "reuse :3000" and who holds it;
 *   - for a registered app on a free port is run through PortPilot's
 *     start_app MCP tool instead, so the start is recorded and verified.
 * Anything else, and any failure to read the config or scan ports, passes
 * the call through untouched: a wrong deny costs more than a missed one.
 *
 * Reads the PortPilot config and runtime sidecar directly, so it works with
 * the desktop app closed. The pure logic lives in guard-core.mjs.
 */
import type { Register, EngineInterface } from 'claude-code'
import {
  decide,
  parseListeners,
  parseStart,
  parseTasklistName,
  routeResult,
  startDir,
  statusLine,
  targetPort,
  type Config,
  type Listeners,
  type Platform,
  type Runtime,
} from './guard-core.mjs'

const REFRESH_MS = 15_000

type Snapshot = { config: Config | null; runtime: Runtime | null; listeners: Listeners | null }

async function detectPlatform($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
  try {
    const { stdout } = await $.process.run(['uname', '-s'], { timeoutMs: 5000 })
    return stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
  } catch {
    return 'linux'
  }
}

/** Mirrors src/core/configPath.js computeDir(). */
async function configDir($: EngineInterface, platform: Platform): Promise<string | null> {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  if (platform === 'win32') {
    const appData = (await $.env.get('APPDATA')) || (home ? `${home}/AppData/Roaming` : null)
    return appData ? `${appData}/portpilot` : null
  }
  if (!home) return null
  if (platform === 'darwin') return `${home}/Library/Application Support/portpilot`
  return `${(await $.env.get('XDG_CONFIG_HOME')) || `${home}/.config`}/portpilot`
}

async function readJson<T>($: EngineInterface, file: string): Promise<T | null> {
  try {
    return JSON.parse(await $.fs.read(file)) as T
  } catch {
    return null
  }
}

/** Listening ports, or null when the scan could not run. */
async function scanPorts($: EngineInterface, platform: Platform): Promise<Listeners | null> {
  const tries: string[][] =
    platform === 'win32' ? [['netstat', '-ano']]
    : platform === 'darwin' ? [['lsof', '-iTCP', '-sTCP:LISTEN', '-n', '-P']]
    : [['ss', '-tlnp'], ['netstat', '-tlnp']]
  for (const argv of tries) {
    try {
      const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 15_000 })
      if (exitCode === 0) return parseListeners(platform, stdout)
    } catch { /* try the next */ }
  }
  return null
}

async function holderName($: EngineInterface, platform: Platform, listeners: Listeners, port: number) {
  const holder = listeners.get(port)
  if (!holder || platform !== 'win32' || !holder.pid || holder.processName !== 'Unknown') return
  try {
    const { stdout } = await $.process.run(['tasklist', '/FI', `PID eq ${holder.pid}`, '/FO', 'CSV', '/NH'], { timeoutMs: 10_000 })
    const name = parseTasklistName(stdout)
    if (name) listeners.set(port, { ...holder, processName: name })
  } catch { /* the name stays Unknown */ }
}

// Fixed for the process; a reload recomputes them.
let platform: Platform | null = null
let dir: string | null = null

async function snapshot($: EngineInterface): Promise<Snapshot> {
  platform ??= await detectPlatform($)
  dir ??= await configDir($, platform)
  if (!dir) return { config: null, runtime: null, listeners: null }
  const [config, runtime] = await Promise.all([
    readJson<Config>($, `${dir}/portpilot-config.json`),
    readJson<Runtime>($, `${dir}/portpilot-runtime.json`),
  ])
  // No config means PortPilot is not set up here: skip the scan.
  const listeners = config ? await scanPorts($, platform) : null
  return { config, runtime, listeners }
}

async function refresh($: EngineInterface) {
  try {
    const { config, runtime, listeners } = await snapshot($)
    // A failed scan keeps the last line rather than claiming "0 up".
    if (config && !listeners) return
    $.ui.status(listeners ? statusLine(config, runtime, listeners) : undefined)
  } catch { /* the line stays as it was */ }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    void refresh($)
    $.clock.every(REFRESH_MS, () => { void refresh($) })
    return started
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const start = parseStart(e.command)
    if (!start) return next(e)

    let snap: Snapshot
    try {
      snap = await snapshot($)
    } catch {
      return next(e)
    }
    const { config, runtime, listeners } = snap
    if (!config || !listeners || !platform) return next(e)

    const windows = platform === 'win32'
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
    const where = startDir(await $.session.cwd(), start.cd, { windows, home })
    const port = targetPort({ start, dir: where, config, windows })
    if (port) await holderName($, platform, listeners, port)

    const decision = decide({ start, dir: where, config, runtime, listeners, windows })

    if (decision.action === 'deny') return { deny: decision.reason }
    if (decision.action === 'pass') return next(e)

    // Route: start the registered app through PortPilot's own MCP tool.
    const tools = await $.tool.list()
    const startTool = tools.find((t) => t.mcp && /portpilot/i.test(t.name) && t.name.endsWith('__start_app'))
    if (!startTool) return next(e)

    const ran = await $.tool.call({ tool: startTool.name, identifier: decision.app.id, sessionId: await $.session.id() })
    void refresh($)
    return routeResult(decision, ran)
  }).catch(($, e, next) => next(e)) // fail open: a guard bug must never block the user's Bash
}
