export function workspacePageIdentity(pathname: string, search: string, state: unknown) {
  const value = state && typeof state === "object" ? state as Record<string, unknown> : {};
  if (pathname === "/admin/fleet") {
    const requested = String(value.activeTab || "operations");
    const legacy = ["drivers", "contracts", "vehicles", "trailers"].includes(requested);
    const tab = legacy ? "fleet" : requested;
    return `${pathname}:${tab}:${tab === "fleet" ? legacy ? requested : value.activeFleetTab || value.fleetTab || "vehicles" : ""}${search}`;
  }
  if (pathname === "/driver/profile") return `${pathname}:${value.profileTab || "dashboard"}${search}`;
  return `${pathname}${search}`;
}
