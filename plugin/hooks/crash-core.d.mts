// Types for crash-core.mjs, so register.tsx type-checks against it.
import type { Config, Listeners, Runtime } from './guard-core.mjs'

export type Crash = {
  key: string
  id: string
  name: string
  port: number | null
  exitCode: number | null
  at: number | null
  errorTail: string | null
  command: string | null
  cwd: string | null
}

export const TAIL_CHARS: number
export function logFileName(appId: string): string
export function sessionCrashes(config: Config | null, runtime: Runtime | null, listeners: Listeners, sessionId: string, now?: number): Crash[]
export function crashHeadline(crash: Crash): string
export function lastLine(tail: string | null | undefined): string
export function tailLines(tail: string | null | undefined, n?: number): string[]
export function fixPrompt(crash: Crash, tail: string | null | undefined): string
export function appCrash(config: Config | null, runtime: Runtime | null, listeners: Listeners, appId: string, now?: number): Crash | null
export const HEARTBEAT_MS: number
export function sessionFileName(sessionId: string): string
export function heartbeat(sessionId: string, cwd: string | null | undefined, now: number): string
export function pendingRequests(inboxText: string | null | undefined, cursor: number): { requests: { appId: string, at: number }[], cursor: number }
