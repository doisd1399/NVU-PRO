import { useLocation, useNavigate } from "react-router-dom";
import { commitNavigation } from "../lib/navigationTransition";
import { useSessionStore } from "../context/AppContext";
import { preloadFleetPanel, preloadRoute } from "../lib/routePreload";
import { workspaceDockActive, workspaceDockRole, workspaceDockTarget, type WorkspaceDockRole } from "../lib/workspaceDock";

export function useWorkspaceNavigation(requestedRole?: WorkspaceDockRole) {
  const { currentUser, activeRole } = useSessionStore();
  const location = useLocation(), navigate = useNavigate();
  const role = requestedRole || workspaceDockRole(location.pathname, location.state, activeRole);
  const active = workspaceDockActive(location.pathname, location.state, role);
  const prepare = (id: string) => {
    const target = workspaceDockTarget(role, id);
    if (!target || id === active) return;
    void preloadRoute(target.pathname).catch(() => undefined);
    if (role === "admin" && id === "profile") void preloadFleetPanel("company").catch(() => undefined);
  };
  const select = (id: string) => {
    if (!currentUser || id === active) return;
    const target = workspaceDockTarget(role, id);
    if (!target) return;
    const state = id === "ranking" ? { backgroundLocation: location, workspaceDockRole: role } : target.state;
    commitNavigation(() => navigate(target.pathname, { state, replace: location.pathname === "/ranking" }));
    prepare(id);
  };
  return { currentUser, role, active, prepare, select };
}
