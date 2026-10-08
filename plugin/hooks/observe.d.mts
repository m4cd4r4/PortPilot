// Types for observe.mjs, so register.tsx type-checks against it.
import type { App, Config, Listeners, Start } from './guard-core.mjs';

export type Pending = { v: 1; key: string; dir: string; cwd: string; raw: string; session: string; at: number; before: number[]; done?: string; port?: number };
export type ProcTable = { self: number | null; procs: Map<number, { pid: number; ppid: number; name: string }> };
export type ToolReply = { deny?: string; isError?: boolean; text?: string };
export type ObserveIo = {
  readPending: (key: string) => Promise<Pending | null>;
  writePending: (key: string, rec: Pending) => Promise<void>;
  listPending: () => Promise<Pending[]>;
  snapshot: () => Promise<{ config: Config | null; listeners: Listeners | null }>;
  procTable: () => Promise<ProcTable>;
  cwdOf: (pid: number) => Promise<string | null>;
  readJson: (path: string) => Promise<{ name?: unknown; [k: string]: unknown } | null>;
  tool: (name: string) => Promise<string | null>;
  call: (args: Record<string, unknown> & { tool: string }) => Promise<ToolReply>;
};

export const OBSERVE_MS: number;
export function isUncPath(p: string | null | undefined): boolean;
export function observeKey(dir: string): string;
export function isOneShot(raw: string): boolean;
export function observable(c: { start: Start | null; sessionCwd: string; config: Config | null; home?: string; windows?: boolean }): { dir: string; cwd: string } | null;
export function parseProcTable(stdout: string): ProcTable;
export function sessionPid(table: ProcTable): number | null;
export function candidates(c: { pendings: Pending[]; listeners: Listeners; table: ProcTable; cwds?: Map<number, string>; windows?: boolean }): Map<string, number[]>;
export function uniqueAppName(wanted: string, cwd: string, apps: App[]): string;
export function noteStart(
  io: Pick<ObserveIo, 'readPending' | 'writePending'>,
  c: { start: Start; sessionCwd: string; config: Config; listeners: Listeners; home: string; windows: boolean; session: string; now: number },
): Promise<Pending | null>;
export function completeObservations(io: ObserveIo, c: { now: number; windows?: boolean }): Promise<Array<{ key: string; done: string; port?: number }>>;
