export type Platform = "windows" | "linux" | "unsupported";
export type Screen =
  "overview" | "folders" | "volumes" | "maintenance" | "activity";
export type ProtectionPhase =
  | "unavailable"
  | "thawed"
  | "frozen"
  | "pending-freeze"
  | "pending-thaw"
  | "unknown";

export interface ExcludedFolder {
  id: string;
  path: string;
}
export interface Profile {
  baselineName: string;
  protectedVolumeIds: string[];
  exclusions: ExcludedFolder[];
}
export interface Activity {
  id: string;
  time: string;
  title: string;
  detail: string;
  kind: "info" | "success" | "warning";
}
export interface Settings {
  version: 1;
  revision: number;
  profile: Profile;
  activity: Activity[];
}
export interface Volume {
  id: string;
  label: string;
  mountPoint: string;
  source: string;
  filesystem: string;
  totalBytes: number;
  freeBytes: number;
  system: boolean;
  readOnly: boolean | null;
}
export interface Protection {
  phase: ProtectionPhase;
  reason: string;
  canFreeze: boolean;
  canThaw: boolean;
  confirmedBaseline: string | null;
}
export interface Computer {
  platform: Platform;
  osName: string;
  osVersion: string;
  architecture: string;
  installationDirectory: string;
  volumes: Volume[];
  diagnosticWarnings: string[];
}
export interface Snapshot {
  mode: "desktop" | "preview";
  appVersion: string;
  settings: Settings;
  computer: Computer;
  protection: Protection;
}
export interface Failure {
  ok: false;
  code: string;
  message: string;
}
export type Result<T> = { ok: true; value: T } | Failure;
export interface Bridge {
  snapshot(): Promise<Result<Snapshot>>;
  saveProfile(
    profile: Profile,
    expectedRevision: number,
  ): Promise<Result<Snapshot>>;
  chooseFolder(): Promise<Result<string | null>>;
  requestProtection(action: "freeze" | "thaw"): Promise<Result<Snapshot>>;
}

declare global {
  interface Window {
    restorewin?: Bridge;
  }
}
