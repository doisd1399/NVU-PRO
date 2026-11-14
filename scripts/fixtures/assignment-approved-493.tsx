import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Bell, Menu } from "lucide-react";
import AssignJob from "../../src/pages/admin/AssignJob";
import { dismissTopOptionModal } from "../../src/lib/optionModalStack";
import { fixture493 } from "./assignment-493-ports";

function Fixture() {
  const [revision, setRevision] = useState(0);
  const [preselected, setPreselected] = useState<any>({});
  (window as any).__assignment493 = {
    reset(options: any = {}) {
      fixture493.reset(options);
      setPreselected(options.preselected || {});
      setRevision(value => value + 1);
      document.documentElement.classList.toggle("dark", options.dark !== false);
    },
    calls: fixture493.calls,
    retry: fixture493.retry,
    release: fixture493.release,
    back: dismissTopOptionModal,
  };
  return <div className="nvu-admin-shell nvu-native-android" style={{ "--nvu-native-header-height": "44px" } as any}>
    <header className="nvu-admin-header" style={{ position: "fixed", top: 0, left: 0, right: 0, height: 44, zIndex: 50, display: "flex", alignItems: "center", gap: 16, padding: "0 18px", background: "var(--nvu-page)", color: "var(--nvu-text)" }}>
      <Menu size={22} /><strong style={{ fontSize: 19 }}>NVU</strong><Bell size={20} style={{ marginLeft: "auto" }} /><img src="/fixture-avatar.png" alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
    </header>
    <main style={{ paddingTop: 44 }} key={revision}>
      <MemoryRouter initialEntries={["/admin/fleet", { pathname: "/admin/assign", state: preselected }]} initialIndex={1}>
        <Routes>
          <Route path="/admin/assign" element={<AssignJob />} />
          <Route path="/admin/fleet" element={<h1 id="assignment-return">Central de gestão</h1>} />
        </Routes>
      </MemoryRouter>
    </main>
  </div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<Fixture />);
