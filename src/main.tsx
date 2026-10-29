import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/workspaceTheme.css";
import "./styles/darkTheme.css";
import { installDeployRecovery } from "./lib/deployRecovery";
import { prepareWebRuntime } from "./lib/webRuntimeRecovery";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { startOtaManager } from "./lib/otaManager";
import { registerCanonicalTripCacheInvalidation } from "./lib/CanonicalTripUpdateEvent";
import { canonicalTripMigrationService } from "./application/trip/CanonicalTripMigrationService";
import { canonicalTripRepository } from "./repositories/CanonicalTripRepository";
import { startCanonicalTripRealtimeSync } from "./application/trip/CanonicalTripRealtimeFirebaseAdapter";
import { SyncManager } from "./services/syncManager";
import { vehiclePhotoService } from "./services/vehiclePhotoService";
import { createRuntimeStartup } from "./lib/runtimeStartup";
import { StartupRecovery } from "./components/common/StartupRecovery";

const startRuntime = createRuntimeStartup([
  prepareWebRuntime,
  () => { installDeployRecovery(); },
  () => {
    const migrationReport = canonicalTripMigrationService.validateStartup();
    if (!migrationReport.valid) throw new Error("CANONICAL_MIGRATION_INVALID");
  },
  () => { canonicalTripRepository.hydrate(); },
  () => { registerCanonicalTripCacheInvalidation(); },
  () => { startCanonicalTripRealtimeSync(); },
  () => { SyncManager.initialize(); },
  () => { vehiclePhotoService.startQueue(); },
]);
// Scoped screens and the driver shell own their realtime subscriptions. A
// second app-wide driver listener duplicated both Firestore alias queries and
// replayed the same full snapshot on every app launch.

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemento raiz do NVU não encontrado.");

const root = createRoot(rootElement);
function mountApplication() {
  try {
    startRuntime();
    root.render(<AppErrorBoundary><App /></AppErrorBoundary>);
    window.requestAnimationFrame(() => startOtaManager());
  } catch (error) {
    console.error("[NVU] Abertura interrompida; registros locais preservados", error);
    root.render(<StartupRecovery onRetry={mountApplication} />);
  }
}
mountApplication();

// SyncManager is the single supervisor. It owns online, queue and visibility
// triggers and delegates every item to SyncEngine exactly once.
