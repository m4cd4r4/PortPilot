import type { Host } from './types';
import { createElectronHost } from './electron';

export type { Host, Snapshot, AppRec, Profile, ProfileFields, Account, Lease, SignIn, ArtRef, Conflict, Group, Run, HistoryData, ThumbRef, Settings, ShareInfo, DiagnoseStatus, DiagnoseEvent, AppFields, PortRow, Detected } from './types';

/** Pick the host for this page. Only Electron exists in Wave 1. */
export function createHost(): Host {
  if ((window as any).portpilot) return createElectronHost();
  throw new Error('No PortPilot host found (window.portpilot is missing)');
}
