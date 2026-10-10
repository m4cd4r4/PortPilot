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
 * A start in a directory no app owns also runs untouched; PortPilot notes it,
 * and when a new port appears soon after, tells Claude (with the next tool
 * result) so Claude can register it through add_app as an observed app (never
 * routed, still guarded). Claude attributes the port; PortPilot never does
 * (observe.mjs).
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
  routeResult,
  startDir,
  statusLine,
  targetPort,
  type Config,
  type Listeners,
  type Platform,
  type Runtime,
} from './guard-core.mjs'
import { checkNotices, EMPTY, freshPorts, noteStart, observable, takeQueued } from './observe.mjs'

const REFRESH_MS = 15_000
const MAX_BANDS = 2

const crashes = atom({ plugin: 'portpilot', key: 'crashes' } as const, [])
const dismissed = atom({ plugin: 'portpilot', key: 'dismissed' } as const, [])
const logsOpen = atom({ plugin: 'portpilot', key: 'logsOpen' } as const, null)
const seen = atom({ plugin: 'portpilot', key: 'seen' } as const, [])
// The last inbox request handled; set to the session's start so older ones never replay.
const inboxCursor = atom({ plugin: 'portpilot', key: 'inboxCursor' } as const, 0)
// Unregistered starts this session ran, and the new-port notices for Claude (observe.mjs).
const observeState = atom({ plugin: 'portpilot', key: 'observe' } as const, EMPTY)

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

/** Names the port's holder; `names` caches per PID so a process holding several ports costs one tasklist. */
async function holderName($: EngineInterface, platform: Platform, listeners: Listeners, port: number, names: Map<number, string | null> = new Map()) {
  const holder = listeners.get(port)
  if (!holder || platform !== 'win32' || !holder.pid || holder.processName !== 'Unknown') return
  if (!names.has(holder.pid)) {
    let name: string | null = null
    try {
      const { stdout } = await $.process.run(['tasklist', '/FI', `PID eq ${holder.pid}`, '/FO', 'CSV', '/NH'], { timeoutMs: 10_000 })
      name = parseTasklistName(stdout) || null
    } catch { /* the name stays Unknown */ }
    names.set(holder.pid, name)
  }
  const name = names.get(holder.pid)
  if (name) listeners.set(port, { ...holder, processName: name })
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
    if (config && listeners) await checkObserved($, { config, runtime, listeners })
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

async function startTool($: EngineInterface) {
  const tools = await $.tool.list()
  return tools.find((t) => t.mcp && /portpilot/i.test(t.name) && t.name.endsWith('__start_app'))
}

/** One new-port check while a noted start is recent; notices wait for the next tool result. */
async function checkObserved($: EngineInterface, snap: Snapshot) {
  const cur = await read($, observeState)
  if (!cur.notes.length) return
  // Name each new port's holder (one tasklist per PID on Windows) so Claude can tell its own server apart.
  const names = new Map<number, string | null>()
  if (platform && snap.listeners) for (const p of freshPorts(cur, snap)) await holderName($, platform, snap.listeners, p, names)
  const now = await $.clock.now()
  await update($, observeState, (s) => {
    const { state, notices } = checkNotices(s, snap, now)
    return notices.length ? { ...state, queue: [...state.queue, ...notices.map((text) => ({ text, at: now }))] } : state
  })
}

/** Takes the queued notices, once: none when opted out, none gone stale. */
async function takeNotices($: EngineInterface): Promise<string[]> {
  if (!(await read($, observeState)).queue.length) return []
  const config = dir ? await readJson<Config>($, `${dir}/portpilot-config.json`) : null
  const now = await $.clock.now()
  let taken: string[] = []
  await update($, observeState, (cur) => { const r = takeQueued(cur, config, now); taken = r.notices; return r.state })
  return taken
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
  // a later crash finds its way back here. start_browser/stop_browser carry it too: it labels
  // the browser profile's advisory claim when no agent name is given. Overwrite any sessionId Claude
  // passed: the model cannot see its session id and guesses one.
  // An observed registration names the session it came from, which Claude cannot see either.
  // After every tool call: a Bash call may have brought a noted start's port
  // up; hand Claude any notice with the result (as a PostToolUse hook would).
  on('tool.call', async ($, e, next) => {
    let call = e
    if (/portpilot/i.test(e.tool) && /__(start_(app|group)|start_browser|stop_browser)$/.test(e.tool)) call = { ...e, sessionId: await $.session.id() } as typeof e
    else if (/portpilot/i.test(e.tool) && /__add_app$/.test(e.tool) && (e as { registeredBy?: unknown }).registeredBy === 'observed') {
      call = { ...e, observedSession: await $.session.id() } as typeof e
    }
    const ran = await next(call)
    if (!('result' in ran) || ran.result === undefined) return ran
    try {
      if (e.tool === 'Bash' && (await read($, observeState)).notes.length) {
        const snap = await snapshot($)
        if (snap.config && snap.listeners) await checkObserved($, snap)
      }
      const notices = await takeNotices($)
      return notices.length ? { ...ran, context: [...(ran.context ?? []), ...notices] } : ran
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e)) // only the stamping can throw: the notice step catches its own

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
      // A start in a directory no app owns runs exactly as typed; PortPilot
      // only notes it, so a port that appears next can be put to Claude.
      try {
        const noted = observable({ start, sessionCwd, config, home, windows })
        if (noted) {
          const pkg = await readJson<{ name?: unknown }>($, `${noted.cwd}/package.json`)
          const now = await $.clock.now()
          await update($, observeState, (s) => noteStart(s, { start, sessionCwd, config, listeners, home, windows, now, pkg }))
        }
      } catch { /* not noted: the start still runs */ }
      return next(e)
    }

    // Route: start the registered app through PortPilot's own MCP tool.
    const tool = await startTool($)
    if (!tool) return next(e)

    const ran = await $.tool.call({ tool: tool.name as McpToolName, identifier: decision.app.id, sessionId: await $.session.id() })
    void refresh($)
    return routeResult(decision, ran)
  }).catch(($, e, next) => next(e)) // fail open: a guard bug must never block the user's Bash
}
