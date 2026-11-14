import type { ScsDelivery } from "../../functions/src/scsTelemetryEvidence";

export type WindowsScope = { driverId: string; companyId: string; jobId: string; contractId: string;
  simulatorKey: string; operationName?: string; progress?: number; total?: number; closed?: boolean };
export type WindowsPending = { id: string; event: ScsDelivery; scope: WindowsScope; state: string; message?: string };
export type WindowsTripSummary = {id:string;state:string;tripId?:string|null;capturedAt:number;origin:string;destination:string;amountCents:number|null;currency:"USD"|"EUR"|null;distanceKm:number|null};
export type WindowsAssistant = {context:string;stage:string;title:string;message:string;freightId:string|null;origin:string;destination:string;currentFreightId:string|null;remainingDistanceKm:number|null;plannedDistanceKm:number|null;recent:WindowsTripSummary[];pending:number};
/** What is on disk. Never evidence that the running game loaded it. */
export type WindowsPluginDisk = { installed: boolean; current: boolean; owned?: boolean; foreign?: boolean; version?: string | null; problem?: string };
/** Canonical plugin/connection state of one simulator, produced by the Windows application (see core/integration.cjs). */
export type WindowsPluginStateCode = "game_missing" | "absent" | "foreign" | "outdated" | "restart_required" | "ready_to_open" | "waiting_load" | "not_loaded"
  | "connected" | "paused" | "disconnected" | "package_invalid";
export type WindowsPluginVersions = { expected: string | null; installed: string | null; loaded: string | null };
export type WindowsGameStatus = { state: WindowsPluginStateCode; code?: string | null; versions: WindowsPluginVersions; gameStartedAt?: string | null; root?: string | null } | null;
export type WindowsVersions = {
  app: { version: string; executable: string; packaged: boolean; electron?: string | null; resources?: string | null };
  web: { version: string | null; buildId: string | null; generatedAt?: string | null; ok: boolean };
  plugin: { expectedVersion: string | null; expectedSha256: string | null; packaged: { present: boolean; version: string | null; consistent: boolean; problem: string | null; signed: boolean } | null };
  games: Record<string, WindowsGameStatus>;
};
export type WindowsStartupSummary = { ok: boolean; finishedAt?: string; warnings: { step: string; code?: string; message?: string }[]; steps: { id: string; ok: boolean; warning?: boolean; code?: string; ms?: number }[] };
export type WindowsPrepareResult = { ok: boolean; step?: string; code?: string; title?: string; action?: string; message?: string; needsElevation?: boolean; retry?: boolean;
  restartRequired?: boolean; elevated?: boolean; key?: string; root?: string; version?: string };
/** "Nova versão disponível": the main process only reports it and opens the official release page on request; nothing is downloaded or installed. */
export type WindowsUpdateInfo = { status: "available" | "current" | "none" | "error"; available: boolean; current?: string; reason?: string; lastError?: string; checkedAt?: number;
  latest?: { version: string; tag: string; url: string; name?: string; prerelease?: boolean; publishedAt?: string | null } | null };
export type WindowsStatus = { active: boolean; enabled: boolean; connected: boolean; paused: boolean;
  appVersion?: string; theme?: "light"|"dark"; telemetryPluginVersion?:string; assistant?:WindowsAssistant; shortcutIssues?:string[];
  jobState?: string; versions?: WindowsVersions; startup?: WindowsStartupSummary | null; update?: WindowsUpdateInfo | null;
  integration?: { phase: string; state?: WindowsPluginStateCode; code?: string | null; message: string; plugin: WindowsPluginDisk | null; pluginVersion?: string | null; versions?: WindowsPluginVersions } | null;
  scope: WindowsScope | null; pending: WindowsPending[]; diagnostic?: string };
export type WindowsGame = { key: "ets2" | "ats"; root: string; label: string; plugin?: WindowsPluginDisk };
export type WindowsNavigation = { action: "panel" | "trips" | "setup"; scope: WindowsScope | null };
export interface WindowsNativeBridge {
  version: number; platform: string;
  signIn(): Promise<{ idToken: string }>; restoreAuth(): Promise<{ idToken: string } | null>; signOut(): Promise<void>;
  syncScope(scope: WindowsScope | null): Promise<WindowsStatus>; start(scope: WindowsScope): Promise<WindowsStatus>;
  status(): Promise<WindowsStatus>; pause(): Promise<WindowsStatus>; stop(): Promise<WindowsStatus>;
  acknowledge(input: { id: string; state: string; tripId?: string; serverValidated?: boolean; message?: string }): Promise<void>;
  openGame(key: string): Promise<void>; discoverGames(): Promise<WindowsGame[]>;
  selectGame(key: string): Promise<WindowsGame | null>; installPlugin(game: WindowsGame): Promise<unknown>;
  removePlugin(game: WindowsGame): Promise<unknown>; showOverlay(): Promise<void>;
  setTheme(theme:"light"|"dark"):Promise<void>; chooseGame(game:WindowsGame):Promise<WindowsGame[]>;
  diagnose(key: string): Promise<Record<string, unknown>>; copyDiagnostics(key: string): Promise<Record<string, unknown>>;
  prepareSimulator(input: { key: string; root?: string; elevate?: boolean }): Promise<WindowsPrepareResult>;
  removeSimulatorPlugin(input: { key: string; elevate?: boolean }): Promise<WindowsPrepareResult>;
  versions(): Promise<WindowsVersions>; copyStartupReport(): Promise<boolean>; openLogs(): Promise<boolean>;
  /** Optional: absent in older application builds. */
  openUpdatePage?(): Promise<boolean>;
  onUpdate(callback: (status: WindowsStatus) => void): () => void;
  onNavigate(callback: (where: WindowsNavigation | string) => void): () => void;
}
declare global { interface Window { nvuWindows?: WindowsNativeBridge; } }
export const isWindowsDesktop = () => typeof window !== "undefined" && window.nvuWindows?.platform === "windows" && window.nvuWindows.version === 1;
/** Platform adapter boundary: the Android adapter remains the Capacitor SimpleAutomation plugin. */
export interface ProAutomationAdapter {
  start(scope: WindowsScope): Promise<unknown>;
  stop(): Promise<unknown>;
}
export const windowsAutomationAdapter: ProAutomationAdapter = {
  async start(scope) {
    if (!isWindowsDesktop() || !["ets2", "ats"].includes(scope.simulatorKey)) throw Error("WINDOWS_SIMULATOR_UNSUPPORTED");
    const result = await window.nvuWindows!.start(scope);
    await window.nvuWindows!.openGame(scope.simulatorKey);
    return result;
  },
  async stop() { if (isWindowsDesktop()) return window.nvuWindows!.stop(); },
};
