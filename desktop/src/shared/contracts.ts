export type Platform = "windows" | "linux" | "unsupported";
export type Screen =
  "overview" | "folders" | "volumes" | "maintenance" | "activity" | "users";
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
  storage?: StorageDiagnostic;
}
export interface StorageDiagnostic {
  operation: "read" | "write";
  nativeCode: string;
  path: string;
  guidance: string;
}
export type Result<T> = { ok: true; value: T } | Failure;
export interface User {
  id: string;
  username: string;
  role: "admin" | "operator";
}
export interface AuthState {
  mode: "desktop" | "preview";
  initialized: boolean;
  user: User | null;
}
export interface RuntimeState {
  trayAvailable: boolean;
  autoStartSupported: boolean;
  autoStart: boolean;
}
export interface Bridge {
  authState(): Promise<Result<AuthState>>;
  setup(username: string, password: string): Promise<Result<AuthState>>;
  login(username: string, password: string): Promise<Result<AuthState>>;
  lock(): Promise<Result<AuthState>>;
  onLocked(listener: () => void): () => void;
  users(): Promise<Result<User[]>>;
  createUser(username: string, password: string): Promise<Result<User[]>>;
  changePassword(
    id: string,
    password: string,
    currentPassword: string,
  ): Promise<Result<AuthState>>;
  deleteUser(id: string): Promise<Result<User[]>>;
  runtime(): Promise<Result<RuntimeState>>;
  setAutoStart(enabled: boolean): Promise<Result<RuntimeState>>;
  quit(): Promise<Result<null>>;
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
