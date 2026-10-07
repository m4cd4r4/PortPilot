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
 * Crash band (C4): when an app this session started crashes, a band above
 * the prompt shows `✕ web crashed · :3000 · exit 1` and its last output line,
 * with Restart, Logs, Fix it and Dismiss. Fix it submits a prompt carrying the
 * crash and its output tail (fenced as untrusted) to this session. Every
 * PortPilot start_app / start_group call gets this session's id, so the
 * sidecar knows which session a crash belongs to.
 *
 * Heartbeat and inbox: every 15 s the mod writes sessions/<id>.json beside
 * the config, so the desktop app can see this session is live, and reads
 * inbox/<id>.json, where the app asks it to look at a crash (Ask Claude). A
 * request names the app only; the prompt is built here, as Fix it builds it.
 *
 * Reads the PortPilot config and runtime sidecar directly, so it works with
 * the desktop app closed. The pure logic lives in guard-core.mjs and
 * crash-core.mjs.
 */
import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface, McpToolName } from 'claude-code'
import type { ShownCrash } from '../types'
import {
  appCrash, crashHeadline, fixPrompt, heartbeat, lastLine, logFileName, pendingRequests, sessionCrashes, sessionFileName, tailLines, TAIL_CHARS,
  type Crash,
} from './crash-core.mjs'
import {
  decide,
  parseListeners,
  parseStart,
  parseTasklistName,
  planAutoRegister,
  routeResult,
  startDir,
  statusLine,
  targetPort,
  worktreeParent,
  type App,
  type AutoRegisterPlan,
  type Config,
  type Listeners,
  type PackageJson,
  type Platform,
  type Runtime,
  type Start,
} from './guard-core.mjs'

const REFRESH_MS = 15_000
const MAX_BANDS = 2

const crashes = atom({ plugin: 'portpilot', key: 'crashes' } as const, [])
const dismissed = atom({ plugin: 'portpilot', key: 'dismissed' } as const, [])
const logsOpen = atom({ plugin: 'portpilot', key: 'logsOpen' } as const, null)
const seen = atom({ plugin: 'portpilot', key: 'seen' } as const, [])
// The last inbox request handled; set to the session's start so older ones never replay.
const inboxCursor = atom({ plugin: 'portpilot', key: 'inboxCursor' } as const, 0)

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
    if (listeners) await refreshCrashes($, config, runtime, listeners)
    if (config && listeners) await beatAndReadInbox($, config, runtime, listeners)
  } catch { /* the line stays as it was */ }
}

/** Writes this session's heartbeat, then hands any requested crash to it. */
async function beatAndReadInbox($: EngineInterface, config: Config, runtime: Runtime | null, listeners: Listeners) {
  if (!dir) return
  const id = await $.session.id()
  const now = await $.clock.now()
  const file = sessionFileName(id)
  try { await $.fs.write(`${dir}/sessions/${file}`, heartbeat(id, await $.session.cwd(), now)) } catch { /* the app sees this session as gone */ }
  let text = ''
  try { text = await $.fs.read(`${dir}/inbox/${file}`) } catch { return }
  const { requests, cursor } = pendingRequests(text, await read($, inboxCursor))
  if (cursor === (await read($, inboxCursor))) return
  await update($, inboxCursor, () => cursor)
  for (const r of requests) {
    const crash = appCrash(config, runtime, listeners, r.appId, now)
    if (!crash) {
      $.ui.toast(`PortPilot: ${r.appId} is not crashed now, nothing sent`)
      continue
    }
    $.ui.toast(`PortPilot: handing the ${crash.name} crash to Claude`)
    await fixIt($, { ...crash, tail: await tailFor($, crash.id, crash.errorTail) })
  }
}

/** The output tail: the desktop's stamp, else the app's log file (MCP starts). */
async function tailFor($: EngineInterface, id: string, stamped: string | null): Promise<string> {
  if (stamped) return stamped
  if (!dir) return ''
  try {
    return (await $.fs.read(`${dir}/logs/${logFileName(id)}`)).slice(-TAIL_CHARS)
  } catch {
    return ''
  }
}

async function refreshCrashes($: EngineInterface, config: Config | null, runtime: Runtime | null, listeners: Listeners) {
  const found = sessionCrashes(config, runtime, listeners, await $.session.id(), await $.clock.now())
  const shown: ShownCrash[] = []
  for (const c of found) shown.push({ ...c, tail: await tailFor($, c.id, c.errorTail) })
  await update($, crashes, () => shown)
  const known = await read($, seen)
  const fresh = shown.filter((c) => !known.includes(c.key))
  if (fresh.length) {
    await update($, seen, (list) => [...list, ...fresh.map((c) => c.key)].slice(-100))
    for (const c of fresh) $.ui.toast(crashHeadline(c))
  }
}

async function portpilotTool($: EngineInterface, name: string) {
  const tools = await $.tool.list()
  return tools.find((t) => t.mcp && /portpilot/i.test(t.name) && t.name.endsWith(`__${name}`))
}

async function startTool($: EngineInterface) {
  return portpilotTool($, 'start_app')
}

/** `git rev-parse --git-dir --git-common-dir` in dir, or nulls outside a repo. */
async function gitDirs($: EngineInterface, cwd: string) {
  try {
    const { exitCode, stdout } = await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], { timeoutMs: 5000 })
    const [gitDir, commonDir] = stdout.trim().split(/\r?\n/)
    if (exitCode === 0 && gitDir && commonDir) return { gitDir, commonDir }
  } catch { /* not a repo, or no git */ }
  return { gitDir: null, commonDir: null }
}

/** The new app's id from add_app / add_worktree's JSON reply, else its name. */
function addedId(text: string | undefined, fallback: string): string {
  try {
    const id = JSON.parse(String(text || '')).app?.id
    if (typeof id === 'string' && id) return id
  } catch { /* not JSON */ }
  return fallback
}

/**
 * Registers an unregistered project's certain start, then routes it through
 * start_app. Returns undefined (run the command as written) when any rule
 * fails or the registration does; after a successful add, a start_app failure
 * is reported as decide's route would report it.
 */
async function autoRegister(
  $: EngineInterface,
  c: { start: Start; dir: string; config: Config; listeners: Listeners; windows: boolean; home: string; sessionCwd: string },
) {
  const cwd = startDir(c.sessionCwd, c.start.cd, { windows: c.windows, home: c.home, keepCase: true })
  const [pkg, addApp, addWt, start] = await Promise.all([
    readJson<PackageJson>($, `${cwd}/package.json`),
    portpilotTool($, 'add_app'),
    portpilotTool($, 'add_worktree'),
    startTool($),
  ])
  const plan: AutoRegisterPlan | null = planAutoRegister({
    start: c.start, dir: c.dir, cwd, config: c.config, listeners: c.listeners, pkg, home: c.home,
    tools: { add: !!addApp, start: !!start }, windows: c.windows,
  })
  if (!plan || !addApp || !start) return undefined

  const parent = addWt ? worktreeParent({ dir: c.dir, ...(await gitDirs($, cwd)), config: c.config, windows: c.windows }) : null
  const added = parent && addWt
    ? await $.tool.call({ tool: addWt.name as McpToolName, path: plan.cwd, command: plan.command, preferredPort: plan.port, parent: parent.id })
    : await $.tool.call({
        tool: addApp.name as McpToolName, name: plan.name, command: plan.command, cwd: plan.cwd, preferredPort: plan.port,
        description: 'Auto-registered from Claude Code',
      })
  if (!added || added.deny !== undefined || added.isError) return undefined

  const id = addedId(added.text, plan.name)
  const app: App = { id, name: parent ? parent.name : plan.name, cwd: plan.cwd, preferredPort: plan.port }
  // Past the add, never fall back to a shell start: a detached start may
  // still be coming up, and a second one would collide with it.
  let ran: { deny?: string; isError?: boolean; text?: string }
  try {
    ran = await $.tool.call({ tool: start.name as McpToolName, identifier: id, sessionId: await $.session.id() })
  } catch (err) {
    ran = { isError: true, text: String((err as Error)?.message || err) }
  }
  void refresh($)
  return routeResult({ app, port: plan.port, cd: c.start.cd, registered: true }, ran)
}

async function restart($: EngineInterface, crash: ShownCrash) {
  const tool = await startTool($)
  if (!tool) {
    $.ui.toast('PortPilot start_app is not connected')
    return
  }
  const ran = await $.tool.call({ tool: tool.name as McpToolName, identifier: crash.id, sessionId: await $.session.id() })
  $.ui.toast(ran.isError ? `Restart failed: ${lastLine(ran.text)}` : `Restarted ${crash.name}`)
  await update($, dismissed, (list) => [...list, crash.key])
  void refresh($)
}

async function fixIt($: EngineInterface, crash: Crash & { tail: string }) {
  await update($, dismissed, (list) => [...list, crash.key])
  await $.prompt.submit({ text: fixPrompt(crash, crash.tail) })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.clock.now()
    await update($, inboxCursor, (c) => c || now)
    void refresh($)
    $.clock.every(REFRESH_MS, () => { void refresh($) })
    return started
  })

  // Stamp this session on every PortPilot start, however Claude called it, so
  // a later crash finds its way back here. Overwrite any sessionId Claude
  // passed: the model cannot see its session id and guesses one.
  on('tool.call', async ($, e, next) => {
    if (!/portpilot/i.test(e.tool) || !/__start_(app|group)$/.test(e.tool)) return next(e)
    return next({ ...e, sessionId: await $.session.id() } as typeof e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const hidden = await read($, dismissed)
    const list = (await read($, crashes)).filter((c) => !hidden.includes(c.key))
    if (!list.length) return next(e)
    const open = await read($, logsOpen)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {list.slice(0, MAX_BANDS).map((c) => (
          <Box key={c.key} flexDirection="column">
            <Text color="red" bold>{crashHeadline(c)}</Text>
            {c.tail ? <Text dimColor wrap="truncate-end">  {lastLine(c.tail)}</Text> : null}
            {open === c.key
              ? <Box flexDirection="column" paddingLeft={2}>
                  {tailLines(c.tail).map((l, i) => <Text key={`l${i}`} dimColor wrap="truncate-end">{l}</Text>)}
                </Box>
              : null}
            <Box gap={1}>
              <Button key={`fix-${c.key}`} label="Fix it" variant="primary" onPress={() => { void fixIt($, c) }} />
              <Button key={`restart-${c.key}`} label="Restart" onPress={() => { void restart($, c) }} />
              <Button key={`logs-${c.key}`} label={open === c.key ? 'Hide logs' : 'Logs'} onPress={() => { void update($, logsOpen, (k) => (k === c.key ? null : c.key)) }} />
              <Button key={`dismiss-${c.key}`} label="Dismiss" role="dismiss" onPress={() => { void update($, dismissed, (l) => [...l, c.key]) }} />
            </Box>
          </Box>
        ))}
        {list.length > MAX_BANDS ? <Text dimColor>+{list.length - MAX_BANDS} more crashed</Text> : null}
      </Box>
    )
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
    const sessionCwd = await $.session.cwd()
    const where = startDir(sessionCwd, start.cd, { windows, home })
    const port = targetPort({ start, dir: where, config, windows })
    if (port) await holderName($, platform, listeners, port)

    const decision = decide({ start, dir: where, config, runtime, listeners, windows })

    if (decision.action === 'deny') return { deny: decision.reason }
    if (decision.action === 'pass') {
      // An unregistered project's certain start: register it, then route it.
      // Any failure before the add lands runs the command as written.
      let routed
      try {
        routed = await autoRegister($, { start, dir: where, config, listeners, windows, home, sessionCwd })
      } catch {
        routed = undefined
      }
      return routed ?? next(e)
    }

    // Route: start the registered app through PortPilot's own MCP tool.
    const tool = await startTool($)
    if (!tool) return next(e)

    const ran = await $.tool.call({ tool: tool.name as McpToolName, identifier: decision.app.id, sessionId: await $.session.id() })
    void refresh($)
    return routeResult(decision, ran)
  }).catch(($, e, next) => next(e)) // fail open: a guard bug must never block the user's Bash
}
