import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import NvuStatusBarController from "../../src/components/common/NvuStatusBarController";
import { useTheme } from "../../src/hooks/useTheme";

// The real status-bar controller on the company profile route, with a recording SystemBars (see the test's plugin).
const route = new URLSearchParams(location.search).get("route") || "company";
const initial = route === "company" ? [{ pathname: "/admin/fleet", state: { activeTab: "company" } }] : route === "driver" ? [{ pathname: "/driver/profile", state: {} }] : [{ pathname: "/ranking", state: {} }];

function Controls() {
  const { theme, toggleTheme } = useTheme();
  (window as any).qaTheme = theme;
  (window as any).qaSetTheme = (wanted: string) => { if ((window as any).qaTheme !== wanted) toggleTheme(); };
  return null;
}
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={initial as any}>
  <Controls /><NvuStatusBarController />
  <header id="hdr" data-nvu-hero-chrome="active" style={{ position: "fixed", top: 0, left: 0, right: 0, height: 84 }} />
  <div id="hero" className="nvu-profile-hero" style={{ position: "absolute", top: 90, left: 0, right: 0, height: 320 }} />
</MemoryRouter>);
