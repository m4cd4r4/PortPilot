// Types for observe.mjs, so register.tsx type-checks against it.
import type { App, Config, Listeners, Runtime, Start } from './guard-core.mjs';

export type Note = { dir: string; cwd: string; command: string; name: string; at: number };
export type ObserveState = { notes: Note[]; lastPorts: number[] | null; noticed: number[]; queue: Array<{ text: string; at: number }> };
type Snap = { config: Config | null; runtime?: Runtime | null; listeners: Listeners | null };

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
export function cmdSafe(raw: string): { command: string; env: Record<string, string> };
export function freshPorts(state: ObserveState, snap: Snap): number[];
export function noticeText(newPorts: number[], notes: Note[], listeners?: Listeners): string;
export function checkNotices(state: ObserveState, snap: Snap, now: number): { state: ObserveState; notices: string[] };
export function takeQueued(state: ObserveState, config: Config | null, now: number): { state: ObserveState; notices: string[] };
