// Types for auto-register.mjs, so register.tsx type-checks against it.
import type { Config, Listeners, PackageJson, RouteResult, Start } from './guard-core.mjs';

export type ToolReply = { deny?: string; isError?: boolean; text?: string };
export type AutoRegisterIo = {
  readJson: (path: string) => Promise<PackageJson | null>;
  exists: (path: string) => Promise<boolean>;
  tool: (name: string) => Promise<string | null>;
  call: (args: Record<string, unknown> & { tool: string }) => Promise<ToolReply>;
  gitDirs: (cwd: string) => Promise<{ gitDir: string | null; commonDir: string | null }>;
  sessionId: () => Promise<string>;
  claim: (key: string) => Promise<'ok' | 'busy' | 'error'>;
  release: (key: string) => Promise<void>;
  reread: () => Promise<{ config: Config | null; listeners: Listeners | null }>;
};

export function isUncPath(p: string | null | undefined): boolean;
export function claimKey(dir: string): string;
export function addedId(text: string | undefined, fallback: string): string;
export function autoRegisterFlow(
  io: AutoRegisterIo,
  c: { start: Start; dir: string; config: Config; listeners: Listeners; windows: boolean; home: string; sessionCwd: string },
): Promise<RouteResult | undefined>;
