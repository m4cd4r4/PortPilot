/**
 * The hooks wiring in register.tsx, run against the engine itself:
 *   claude plugin test plugin
 * CI has no claude CLI; the pure logic is covered there by
 * tests/plugin-mod.test.mjs. The world beneath the plugin (env, files, the
 * port scan, the session, PortPilot's start_app tool) is faked by the test's
 * own hooks.
 */
import { test, expect, mock, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = 'C:/fake/AppData/portpilot'
const APP_CWD = 'C:/work/api'

const CONFIG = {
  apps: [
    { id: 'web', name: 'web', cwd: 'C:/work/web', command: 'npm run dev', preferredPort: 3000 },
    { id: 'api', name: 'api', cwd: APP_CWD, command: 'npm run dev', preferredPort: 4000 },
  ],
}
const RUNTIME = {
  apps: { web: { port: 3000, startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'abcd1234' } } },
}
const NETSTAT = [
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4812',
  '  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       777',
].join('\r\n')

type World = {
  cwd?: string
  withStartTool?: boolean
  startFails?: boolean
  config?: object | null
  bashRuns?: string[]
  startCalls?: unknown[]
  statuses?: (string | undefined)[]
  runtime?: object
  prompts?: string[]
  toasts?: string[]
  log?: string
  inbox?: object
  writes?: { path: string, text: string }[]
  netstat?: () => string
}

/** Fakes the world beneath the plugin. */
function world(on: On, w: World = {}) {
  mock.env(on, { OS: 'Windows_NT', APPDATA: 'C:/fake/AppData', USERPROFILE: 'C:/Users/me' })
  const config = w.config === undefined ? CONFIG : w.config
  on('fs.read', async (_$, e) => {
    const path = e.path.split(String.fromCharCode(92)).join('/') // the engine hands Windows paths with backslashes
    if (path === `${DIR}/portpilot-config.json` && config) return { value: JSON.stringify(config) }
    if (path === `${DIR}/portpilot-runtime.json`) return { value: JSON.stringify(w.runtime ?? RUNTIME) }
    if (path === `${DIR}/logs/api.log` && w.log != null) return { value: w.log }
    if (path === `${DIR}/inbox/sess-1.json` && w.inbox) return { value: JSON.stringify(w.inbox) }
    return { deny: `ENOENT ${e.path}` }
  })
  on('process.run', async (_$, e) => {
    const [cmd] = e.argv
    const stdout = cmd === 'netstat' ? (w.netstat ? w.netstat() : NETSTAT)
      : cmd === 'tasklist' ? '"node.exe","4812","Console","1","52,000 K"'
      : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('session.cwd', async () => ({ value: w.cwd ?? 'C:/work' }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('tool.list', async () => ({ value: w.withStartTool === false ? [] : [
    { name: 'Bash', description: 'shell', mcp: false },
    { name: 'mcp__portpilot__start_app', description: 'start an app', mcp: true },
  ] }))
  on('ui.status', async (_$, e) => { w.statuses?.push(e.text); return { value: undefined } })
  on('ui.toast', async (_$, e) => { w.toasts?.push(e.text); return { value: undefined } })
  on('prompt.submit', async (_$, e) => { w.prompts?.push(e.text); return { text: e.text } })
  on('fs.write', async (_$, e) => { w.writes?.push({ path: e.path.split(String.fromCharCode(92)).join('/'), text: e.text }); return { value: undefined } })
  // The engine's own drawing, for when the band has nothing to show.
  on('ui.render', async () => ({ type: 'Box' }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'mcp__portpilot__start_app') {
      w.startCalls?.push(e)
      if (w.startFails) return { isError: true, result: 'start failed', text: '{"success":false,"error":"Port 4000 did not open"}' } as never
      return { result: 'started api on :4000', text: 'started api on :4000' } as never
    }
    w.bashRuns?.push((e as { command: string }).command)
    return { result: { stdout: 'RAN', stderr: '', interrupted: false } } as never
  })
}

const bash = (command: string) => ({ tool: 'Bash', tool_use_id: 't1', command }) as never

test('a start on a busy port is denied and names the holder', async ($, on) => {
  const bashRuns: string[] = []
  world(on, { cwd: 'C:/work/web', bashRuns })
  const r = await $.tool.call(bash('npm run dev'))
  expect(bashRuns).toEqual([])
  expect(r.deny).toContain('web is already running on :3000')
  expect(r.deny).toContain('reuse http://localhost:3000')
})

// A test's own $.tool.call carries no context back: a plugin in the outermost
// tier reads what reaches the model after PortPilot's hook, and reports it as
// a toast (plugins run isolated: no shared variables).
const contextProbe = {
  name: 'context-probe',
  tier: 'prepend' as const,
  register: ((on: On) => {
    on('tool.call', async ($, e, next) => {
      const r = await next(e)
      $.ui.toast(`CTX ${JSON.stringify(('result' in r && r.context) || [])}`)
      return r
    })
  }) as never,
}

test('a new port after an unregistered start is put to Claude once, with the next result', { plugins: [contextProbe] }, async ($, on) => {
  const bashRuns: string[] = []
  const toasts: string[] = []
  let up = false
  const NEW = '  TCP    0.0.0.0:4799           0.0.0.0:0              LISTENING       999'
  world(on, { cwd: 'C:/work/shop', bashRuns, toasts, netstat: () => (up ? `${NETSTAT}\r\n${NEW}` : NETSTAT) })
  mock.clock(on, { now: Date.parse('2026-10-08T03:00:00Z') })
  const seenContext = () => toasts.filter((t) => t.startsWith('CTX ')).map((t) => JSON.parse(t.slice(4)) as string[])
  await $.tool.call(bash('npm run dev'))
  expect(bashRuns).toEqual(['npm run dev'])
  up = true
  await $.tool.call(bash('sleep 30'))
  await $.tool.call(bash('sleep 30'))
  expect(seenContext()).toEqual([
    [],
    [expect.stringMatching(/^PortPilot: :4799 started listening after `npm run dev` in shop\.\n- :4799: node\.exe, PID 999, bound to 0\.0\.0\.0\n/)],
    [],
  ])
})

test('an observed add_app is stamped with this session', async ($, on) => {
  const calls: unknown[] = []
  on('tool.call', { tool: 'mcp__portpilot__add_app' }, async (_$, e) => { calls.push(e); return { result: 'ok', text: 'ok' } as never })
  world(on)
  await $.tool.call({ tool: 'mcp__portpilot__add_app', name: 'shop', command: 'npm run dev', cwd: 'C:/work/shop', registeredBy: 'observed', observedSession: 'guess' } as never)
  expect(calls).toEqual([expect.objectContaining({ observedSession: 'sess-1' })])
})

test('an unmanaged holder is named by its tasklist image', async ($, on) => {
  const bashRuns: string[] = []
  world(on, { bashRuns })
  const r = await $.tool.call(bash('npx vite --port 8080'))
  expect(bashRuns).toEqual([])
  expect(r.deny).toContain(':8080 is held by node.exe (PID 777')
  expect(r.deny).toContain('not managed')
})

test('a registered app on a free port is routed through start_app', async ($, on) => {
  const bashRuns: string[] = []
  const startCalls: unknown[] = []
  world(on, { bashRuns, startCalls })
  const r = await $.tool.call(bash('cd api && npm run dev'))
  expect(bashRuns).toEqual([])
  expect(startCalls).toEqual([expect.objectContaining({ identifier: 'api', sessionId: 'sess-1' })])
  expect(r.result).toEqual(expect.objectContaining({ stdout: expect.stringContaining('PortPilot started api on :4000') }))
})

test('a failed start_app is a deny, not "started"', async ($, on) => {
  const bashRuns: string[] = []
  world(on, { cwd: APP_CWD, bashRuns, startFails: true })
  const r = await $.tool.call(bash('npm run dev'))
  expect(bashRuns).toEqual([])
  expect(r.result).toBeUndefined()
  expect(r.deny).toContain('starting it through start_app failed')
  expect(r.deny).toContain('Port 4000 did not open')
})

test('an explicit port other than preferredPort passes through', async ($, on) => {
  const bashRuns: string[] = []
  world(on, { cwd: APP_CWD, bashRuns })
  await $.tool.call(bash('npm run dev -- --port 4100'))
  expect(bashRuns).toEqual(['npm run dev -- --port 4100'])
})

test('no start_app tool: the registered start passes through', async ($, on) => {
  const bashRuns: string[] = []
  world(on, { cwd: APP_CWD, bashRuns, withStartTool: false })
  await $.tool.call(bash('npm run dev'))
  expect(bashRuns).toEqual(['npm run dev'])
})

test('no PortPilot config: everything passes through', async ($, on) => {
  const bashRuns: string[] = []
  world(on, { cwd: 'C:/work/web', bashRuns, config: null })
  await $.tool.call(bash('npm run dev'))
  expect(bashRuns).toEqual(['npm run dev'])
})

test('non-server commands are not touched', async ($, on) => {
  const bashRuns: string[] = []
  world(on, { cwd: 'C:/work/web', bashRuns })
  await $.tool.call(bash('npm run build'))
  expect(bashRuns).toEqual(['npm run build'])
})

test('session start sets the status line and refreshes it on the timer', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const clock = mock.clock(on)
  world(on, { statuses })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(statuses).toEqual(['⚓ 1 up · :3000 web✦'])
  await clock.advance(15_000)
  expect(statuses.length).toBe(2)
})

// ---- crash band (C4) --------------------------------------------------------

const NOW = Date.parse('2026-10-07T07:00:00Z')
const CRASHED_AT = NOW - 5_000
const CRASH_KEY = `api@${CRASHED_AT}`
const crashRuntime = (sessionId: string) => ({
  apps: {
    ...RUNTIME.apps,
    api: { crashed: { at: CRASHED_AT, exitCode: 1, port: 4000, errorTail: null, startedBy: { kind: 'claude', surface: 'mcp', sessionId, at: new Date(NOW - 600_000).toISOString() } } },
  },
})
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

/** Starts the session so the first refresh finds the crash. */
async function started($: Parameters<TestBody>[0], on: On, w: World) {
  const clock = mock.clock(on, { now: NOW })
  world(on, w)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  return clock
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Fix it sends the crash and its fenced log tail to this session`, async ($, on) => {
    const prompts: string[] = []
    const toasts: string[] = []
    await started($, on, { runtime: crashRuntime('sess-1'), prompts, toasts, log: 'ready\nError: EADDRINUSE ```x```\n' })
    expect(toasts).toEqual(['✕ api crashed · :4000 · exit 1'])
    const ui = await $.ui.mount({ plugin: 'portpilot', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /api crashed · :4000 · exit 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /EADDRINUSE/ })).toBeDefined()
    await ui.press({ key: `fix-${CRASH_KEY}` })
    expect(prompts.length).toBe(1)
    expect(prompts[0]).toContain('"api" (app id `api`) that you started crashed (port :4000, exit code 1)')
    expect(prompts[0]).toContain('````text\nready\nError: EADDRINUSE ```x```\n````')
    expect(prompts[0]).toContain('untrusted program output')
    expect(await ui.find({ type: 'Text', text: /api crashed/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: Logs opens the tail; Dismiss hides the band`, async ($, on) => {
    await started($, on, { runtime: crashRuntime('sess-1'), log: 'one\ntwo\nthree\n' })
    const ui = await $.ui.mount({ plugin: 'portpilot', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^one$/ })).toBeUndefined()
    await ui.press({ key: `logs-${CRASH_KEY}` })
    expect(await ui.find({ type: 'Text', text: /^one$/ })).toBeDefined()
    await ui.press({ key: `dismiss-${CRASH_KEY}` })
    expect(await ui.find({ type: 'Text', text: /api crashed/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a crash another session started shows no band and no toast`, async ($, on) => {
    const toasts: string[] = []
    await started($, on, { runtime: crashRuntime('sess-other'), toasts })
    expect(toasts).toEqual([])
    const ui = await $.ui.mount({ plugin: 'portpilot', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /crashed/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('Restart calls start_app for the crashed app with this session id', async ($, on) => {
  const startCalls: unknown[] = []
  const toasts: string[] = []
  await started($, on, { runtime: crashRuntime('sess-1'), startCalls, toasts })
  const ui = await $.ui.mount({ plugin: 'portpilot', surface: 'terminal', ...BAND })
  await ui.press({ key: `restart-${CRASH_KEY}` })
  expect(startCalls).toEqual([expect.objectContaining({ identifier: 'api', sessionId: 'sess-1' })])
  expect(toasts).toContain('Restarted api')
  await ui.unmount()
})

test('every start_app call is stamped with this session, over any id Claude passed', async ($, on) => {
  const startCalls: unknown[] = []
  world(on, { startCalls })
  await $.tool.call({ tool: 'mcp__portpilot__start_app', tool_use_id: 't2', identifier: 'api' } as never)
  await $.tool.call({ tool: 'mcp__portpilot__start_app', tool_use_id: 't3', identifier: 'web', sessionId: 'session_guessed' } as never)
  expect(startCalls).toEqual([
    expect.objectContaining({ identifier: 'api', sessionId: 'sess-1' }),
    expect.objectContaining({ identifier: 'web', sessionId: 'sess-1' }),
  ])
})

// ---- heartbeat and inbox (slice 3) ------------------------------------------

test('the session writes a heartbeat the desktop app can read', async ($, on) => {
  const writes: { path: string, text: string }[] = []
  await started($, on, { writes })
  const beat = writes.find((x) => x.path === `${DIR}/sessions/sess-1.json`)
  expect(beat && JSON.parse(beat.text)).toEqual({ sessionId: 'sess-1', cwd: 'C:/work', at: NOW })
})

test('an inbox request hands that crash to this session once, whoever started the app', async ($, on) => {
  const prompts: string[] = []
  const toasts: string[] = []
  const inbox = { requests: [{ appId: 'web', at: NOW - 1 }, { appId: 'api', at: NOW + 1 }] }
  const clock = await started($, on, { runtime: crashRuntime('sess-other'), inbox, prompts, toasts, log: 'Error: boom\n' })
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('"api" (app id `api`)')
  expect(prompts[0]).toContain('```text\nError: boom\n```')
  expect(toasts).toContain('PortPilot: handing the api crash to Claude')
  await clock.advance(15_000)
  expect(prompts.length).toBe(1)
})

test('an inbox request for an app that is running again sends nothing', async ($, on) => {
  const prompts: string[] = []
  const toasts: string[] = []
  await started($, on, { inbox: { requests: [{ appId: 'web', at: NOW + 1 }] }, prompts, toasts })
  expect(prompts).toEqual([])
  expect(toasts).toContain('PortPilot: web is not crashed now, nothing sent')
})
