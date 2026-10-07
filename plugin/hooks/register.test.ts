/**
 * The hooks wiring in register.ts, run against the engine itself:
 *   claude plugin test plugin
 * CI has no claude CLI; the pure logic is covered there by
 * tests/plugin-mod.test.mjs. The world beneath the plugin (env, files, the
 * port scan, the session, PortPilot's start_app tool) is faked by the test's
 * own hooks.
 */
import { test, expect, mock } from 'claude-code/testing'
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
}

/** Fakes the world beneath the plugin. */
function world(on: On, w: World = {}) {
  mock.env(on, { OS: 'Windows_NT', APPDATA: 'C:/fake/AppData', USERPROFILE: 'C:/Users/me' })
  const config = w.config === undefined ? CONFIG : w.config
  on('fs.read', async (_$, e) => {
    const path = e.path.split(String.fromCharCode(92)).join('/') // the engine hands Windows paths with backslashes
    if (path === `${DIR}/portpilot-config.json` && config) return { value: JSON.stringify(config) }
    if (path === `${DIR}/portpilot-runtime.json`) return { value: JSON.stringify(RUNTIME) }
    return { deny: `ENOENT ${e.path}` }
  })
  on('process.run', async (_$, e) => {
    const [cmd] = e.argv
    const stdout = cmd === 'netstat' ? NETSTAT
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
