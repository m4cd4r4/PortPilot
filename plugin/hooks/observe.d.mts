// Types for observe.mjs, so register.tsx type-checks against it.
import type { App, Config, Listeners, Runtime, Start } from './guard-core.mjs';

export type Note = { dir: string; cwd: string; command: string; name: string; at: number };
export type ObserveState = { notes: Note[]; lastPorts: number[] | null; noticed: number[]; queue: string[] };

export const NOTICE_MS: number;
export const EMPTY: ObserveState;
export function isUncPath(p: string | null | undefined): boolean;
export function isOneShot(raw: string): boolean;
export function observable(c: { start: Start | null; sessionCwd: string; config: Config | null; home?: string; windows?: boolean }): { dir: string; cwd: string } | null;
export function uniqueAppName(wanted: string, cwd: string, apps: App[]): string;
export function suggestName(pkg: { name?: unknown } | null, cwd: string, config: Config | null): string;
export function noteStart(
  state: ObserveState,
  c: { start: Start; sessionCwd: string; config: Config; listeners: Listeners; home: string; windows: boolean; now: number; pkg?: { name?: unknown } | null },
): ObserveState;
export function noticeText(port: number, notes: Note[]): string;
export function checkNotices(
  state: ObserveState,
  snap: { config: Config | null; runtime?: Runtime | null; listeners: Listeners | null },
  now: number,
): { state: ObserveState; notices: string[] };
