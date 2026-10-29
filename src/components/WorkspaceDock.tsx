import React from "react";
import { useWorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import type { WorkspaceDockRole } from "../lib/workspaceDock";
import { DriverDock } from "./driver/DriverDock";
import "./driver/DriverWorkspace.css";
import "./WorkspaceDock.css";

export function WorkspaceDock({ role: requestedRole }: { role?: WorkspaceDockRole }) {
  const { currentUser, role, active, prepare, select } = useWorkspaceNavigation(requestedRole);
  if (!currentUser || !active) return null;
  return <>
    <div className="nvu-workspace-dock-space" aria-hidden="true" />
    <div className="nvu-workspace-dock-region" data-nvu-swipe-ignore>
      <DriverDock active={active} variant={role === "admin" ? "company" : "driver"} onIntent={prepare} onSelect={select} />
    </div>
  </>;
}
