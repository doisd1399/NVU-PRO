export type WorkspaceDockRole = "driver" | "admin";
export type WorkspaceDockId = "dashboard" | "activity" | "results" | "news" | "ranking" | "profile";
export type WorkspaceDockLocation = { pathname: string; state?: Record<string, unknown> };

const ids: readonly string[] = ["dashboard", "activity", "results", "news", "ranking", "profile"];
const stateRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

/** Route state is only a navigation preference; authorization stays in the route guards. */
export function workspaceDockRole(pathname: string, state: unknown, activeRole: unknown): WorkspaceDockRole {
  if (pathname.startsWith("/admin/")) return "admin";
  if (pathname.startsWith("/driver/")) return "driver";
  const requested = stateRecord(state).workspaceDockRole;
  return requested === "admin" || requested === "driver" ? requested : activeRole === "admin" ? "admin" : "driver";
}

export function workspaceDockActive(pathname: string, state: unknown, role: WorkspaceDockRole): WorkspaceDockId | null {
  if (pathname === "/ranking") return "ranking";
  const prefix = role === "admin" ? "/admin" : "/driver";
  if (pathname === `${prefix}/news`) return "news";
  if (pathname === `${prefix}/history`) return "activity";
  if (pathname === `${prefix}/reports`) return "results";
  const routeState = stateRecord(state);
  if (role === "admin" && pathname === "/admin/fleet") {
    if (routeState.activeTab === "company") return "profile";
    if (routeState.activeTab === "history") return "activity";
    if (routeState.activeTab === "reports") return "results";
    return "dashboard";
  }
  if (role === "driver" && pathname === "/driver/profile") {
    const tab = routeState.profileTab;
    if (tab === "operations") return "activity";
    return ["dashboard", "activity", "results", "profile"].includes(String(tab)) ? tab as WorkspaceDockId : "dashboard";
  }
  return null;
}

export function workspaceDockTarget(role: WorkspaceDockRole, id: string): WorkspaceDockLocation | null {
  if (!ids.includes(id)) return null;
  if (id === "ranking") return { pathname: "/ranking" };
  if (id === "news") return { pathname: role === "admin" ? "/admin/news" : "/driver/news" };
  if (role === "driver") return { pathname: "/driver/profile", state: { profileTab: id } };
  if (id === "activity") return { pathname: "/admin/history" };
  if (id === "results") return { pathname: "/admin/reports" };
  return { pathname: "/admin/fleet", state: { activeTab: id === "profile" ? "company" : "operations" } };
}
