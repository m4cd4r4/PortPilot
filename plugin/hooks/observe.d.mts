// Types for observe.mjs, so register.tsx type-checks against it.
import type { App, Config, Listeners, Runtime, Start } from './guard-core.mjs';

export type Pending = { v: 1; key: string; dir: string; cwd: string; raw: string; command?: string; session: string; at: number; before: number[]; done?: string; port?: number };
export type ProcTable = { self: number | null; procs: Map<number, { pid: number; ppid: number; name: string; created: number; cmd: string }> };
export type ToolReply = { deny?: string; isError?: boolean; text?: string };
export type ObserveIo = {
  readPending: (key: string) => Promise<Pending | null>;
  writePending: (key: string, rec: Pending) => Promise<void>;
  removePending: (key: string) => Promise<void>;
  listPending: () => Promise<Pending[]>;
  snapshot: () => Promise<{ config: Config | null; runtime?: Runtime | null; listeners: Listeners | null }>;
  procTable: () => Promise<ProcTable>;
  cwdOf: (pid: number) => Promise<string | null>;
  readJson: (path: string) => Promise<{ name?: unknown; [k: string]: unknown } | null>;
  tool: (name: string) => Promise<string | null>;
  call: (args: Record<string, unknown> & { tool: string }) => Promise<ToolReply>;
};

export const OBSERVE_MS: number;
export const PRUNE_MS: number;
export const READ_LIMIT: number;
export function isUncPath(p: string | null | undefined): boolean;
export function observeKey(dir: string): string;
export function isOneShot(raw: string): boolean;
export function observable(c: { start: Start | null; sessionCwd: string; config: Config | null; home?: string; windows?: boolean }): { dir: string; cwd: string } | null;
export function parseProcTable(stdout: string): ProcTable;
export function sessionPid(table: ProcTable): number | null;
export function shellChain(pid: number, owner: number, procs: ProcTable['procs']): number[] | null;
export function bornAfter(chain: number[], owner: number, procs: ProcTable['procs'], at: number): boolean;
export function commandScore(p: Pick<Pending, 'raw' | 'command'>, chain: number[], procs: ProcTable['procs']): number;
export function candidates(c: { pendings: Pending[]; listeners: Listeners; table: ProcTable; cwds?: Map<number, string>; windows?: boolean; config?: Config | null; runtime?: Runtime | null }): Map<string, number[]>;
export function pickPendingFiles(entries: ReadonlyArray<{ name: string; mtimeMs?: number }>, now: number): { read: string[]; prune: string[] };
export function removeArgv(file: string, windows: boolean): string[] | null;
export function uniqueAppName(wanted: string, cwd: string, apps: App[]): string;
export function noteStart(
  io: Pick<ObserveIo, 'readPending' | 'writePending'>,
  c: { start: Start; sessionCwd: string; config: Config; listeners: Listeners; home: string; windows: boolean; session: string; now: number; command?: string },
): Promise<Pending | null>;
export function completeObservations(io: ObserveIo, c: { now: number; windows?: boolean; session: string }): Promise<Array<{ key: string; done: string; port?: number }>>;
