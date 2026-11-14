import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import NvuStatusBarController from "../../src/components/common/NvuStatusBarController";
import { useTheme } from "../../src/hooks/useTheme";

// The real status-bar controller on the company profile route, with a recording SystemBars (see the test's plugin).
const route = new URLSearchParams(location.search).get("route") || "company";
const lateHero = new URLSearchParams(location.search).get("late") === "1";
const initial = route === "company" ? [{ pathname: "/admin/fleet", state: { activeTab: "company" } }]
  : route === "dashboard" ? [{ pathname: "/driver/profile", state: { profileTab: "dashboard" } }]
  : [{ pathname: "/ranking", state: {} }];
// The banner of the driver's "Operação atual" starts at the very top (full bleed); it may mount after the first render.
function Hero() {
  const [mounted, setMounted] = React.useState(!lateHero);
  React.useEffect(() => { if (lateHero) { const t = setTimeout(() => setMounted(true), 450); return () => clearTimeout(t); } }, []);
  return mounted ? <div id="hero" className="nvu-profile-hero" style={{ position: "absolute", top: route === "dashboard" ? -8 : 90, left: 0, right: 0, height: 320 }} /> : null;
}

function Controls() {
  const { theme, toggleTheme } = useTheme();
  (window as any).qaTheme = theme;
  (window as any).qaSetTheme = (wanted: string) => { if ((window as any).qaTheme !== wanted) toggleTheme(); };
  return null;
}
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={initial as any}>
  <Controls /><NvuStatusBarController />
  <header id="hdr" data-nvu-hero-chrome="active" style={{ position: "fixed", top: 0, left: 0, right: 0, height: 84 }} />
  <Hero />
</MemoryRouter>);
