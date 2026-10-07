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

declare module 'claude-code' {
  interface PluginState {
    portpilot: {
      crashes: ShownCrash[]
      dismissed: string[]
      logsOpen: string | null
      seen: string[]
      inboxCursor: number
    }
  }
}
