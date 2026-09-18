import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installDeployRecovery } from "./lib/deployRecovery";
import { prepareWebRuntime } from "./lib/webRuntimeRecovery";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { startOtaManager } from "./lib/otaManager";

prepareWebRuntime();
installDeployRecovery();

// The application paints first. OTA and LiveUpdate.ready() run only after the
// initial React mount, so a manifest/network failure cannot delay the NVU shell.
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemento raiz do NVU não encontrado.");
}

createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

window.requestAnimationFrame(() => {
  startOtaManager();
});
