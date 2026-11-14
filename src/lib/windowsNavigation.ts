import type { WindowsNavigation, WindowsScope } from "./windowsAutomation";
export function resolveWindowsNavigation(event: WindowsNavigation | string, scope: WindowsScope | null): WindowsNavigation["action"] | null {
  if (!scope?.driverId) return null;
  if (typeof event === "string") return event === "/driver/profile" ? "panel" : event === "/driver/history" ? "trips" : null;
  if (!event || !["panel", "trips", "setup"].includes(event.action) || event.scope?.driverId !== scope.driverId) return null;
  if (event.action === "setup") return "setup";
  return ["companyId", "jobId", "contractId", "simulatorKey"].every(key => scope[key as keyof WindowsScope]
    && event.scope?.[key as keyof WindowsScope] === scope[key as keyof WindowsScope]) ? event.action : null;
}
