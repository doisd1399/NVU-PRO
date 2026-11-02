import type { ScsDelivery } from "../../functions/src/scsTelemetryEvidence";

export type WindowsScope = { driverId: string; companyId: string; jobId: string; contractId: string;
  simulatorKey: string; operationName?: string; progress?: number; total?: number; closed?: boolean };
export type WindowsPending = { id: string; event: ScsDelivery; scope: WindowsScope; state: string; message?: string };
export type WindowsTripSummary = {id:string;state:string;tripId?:string|null;capturedAt:number;origin:string;destination:string;amountCents:number|null;currency:"USD"|"EUR"|null;distanceKm:number|null};
export type WindowsAssistant = {context:string;stage:string;title:string;message:string;freightId:string|null;origin:string;destination:string;currentFreightId:string|null;remainingDistanceKm:number|null;plannedDistanceKm:number|null;recent:WindowsTripSummary[];pending:number};
export type WindowsStatus = { active: boolean; enabled: boolean; connected: boolean; paused: boolean;
  appVersion?: string; theme?: "light"|"dark"; telemetryPluginVersion?:string; assistant?:WindowsAssistant; shortcutIssues?:string[];
  jobState?: string;
  integration?: { phase: string; message: string; plugin: { installed: boolean; current: boolean } | null; pluginVersion?: string | null } | null;
  scope: WindowsScope | null; pending: WindowsPending[]; diagnostic?: string };
export type WindowsGame = { key: "ets2" | "ats"; root: string; label: string; plugin?: { installed: boolean; current: boolean } };
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
