// The mod's $.state contract (crash band, C4). Self-contained by rule: the
// crash fields mirror Crash in hooks/crash-core.d.mts.

/** A crash this session owns, with the output tail the band shows and Fix it sends. */
export type ShownCrash = {
  key: string
  id: string
  name: string
  port: number | null
  exitCode: number | null
  at: number | null
  errorTail: string | null
  command: string | null
  cwd: string | null
  tail: string
}

/** An unregistered start this session ran (mirrors Note in hooks/observe.d.mts). */
export type ObserveNote = { dir: string; cwd: string; command: string; name: string; at: number }

/** What observe.mjs keeps per session: recent starts, the last port scan, ports already told, notices not yet handed over. */
export type ObserveState = { notes: ObserveNote[]; lastPorts: number[] | null; noticed: number[]; queue: string[] }

declare module 'claude-code' {
  interface PluginState {
    portpilot: {
      crashes: ShownCrash[]
      dismissed: string[]
      logsOpen: string | null
      seen: string[]
      inboxCursor: number
      observe: ObserveState
    }
  }
}
