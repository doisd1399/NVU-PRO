import { ProOverlayProbe } from "../lib/proOverlayProbe";
import { assertWorkModeEntryAllowed } from "./workModeAvailabilityService";
import { explainOverlayPermissionBeforeSettings } from "./overlayPermissionGuide";
import { getCachedSimpleAutomationCities, loadSimpleAutomationCities } from "./simpleAutomationCityService";
import {
  getSimpleAutomationSimulator,
  type SimpleAutomationCity,
  type SimpleAutomationSimulatorKey,
} from "../lib/simpleAutomation";
import { getProLaunchAvailability } from "../lib/proLaunchAvailability";
import {
  isSimpleAutomationNativeAvailable,
  SimpleAutomation,
  recordSimpleAutomationProTiming,
  type SimpleAutomationNativeStatus,
} from "../lib/simpleAutomationNative";
import { toProOperationHistoryRows } from "../lib/proOperationHistory";
import type { NormalizedTrip } from "../lib/tripNormalizer";

export type SimpleAutomationOperationContext = {
  companyId?: string;
  driverId?: string;
  jobId?: string;
  contractId?: string;
  operationName?: string;
  contractName?: string;
  confirmedTripCount?: number;
  jobProgress?: number;
  jobTotalDeliveries?: number;
  jobStatus?: string;
  operationClosed?: boolean;
  vehicleName?: string;
  trailerName?: string;
  historyTrips?: NormalizedTrip[];
  historyReady?: boolean;
};

export type SimpleAutomationLaunchResult =
  | { status: "not-native" }
  | { status: "module-missing" }
  | { status: "overlay-permission" }
  | { status: "not-installed" }
  | { status: "opened" }
  | { status: "failed"; message: string };

export async function launchSimpleAutomation(
  simulatorKey: SimpleAutomationSimulatorKey,
  cities: readonly SimpleAutomationCity[],
  companyName = "Empresa",
  operationContext: SimpleAutomationOperationContext = {},
  entryCheck?: Promise<void>,
): Promise<SimpleAutomationLaunchResult> {
  const simulator = getSimpleAutomationSimulator(simulatorKey);
  if (!simulator) return { status: "failed", message: "Simulador Pro inválido." };

  const availability = getProLaunchAvailability({
    job: {
      status: operationContext.jobStatus,
    },
    confirmedTripCount: Math.max(0, Number(operationContext.confirmedTripCount || 0)),
    totalDeliveries: operationContext.jobTotalDeliveries,
    hasContract: Boolean(operationContext.contractId),
    hasUser: Boolean(operationContext.driverId),
    hasCompany: Boolean(operationContext.companyId),
  });
  if (!availability.canLaunch) {
    return { status: "failed", message: availability.message };
  }

  if (!isSimpleAutomationNativeAvailable()) return { status: "not-native" };

  try {
    const launchStartedAt = Date.now();
    recordSimpleAutomationProTiming("pro_entry_clicked", 0);
    await (entryCheck ?? assertWorkModeEntryAllowed("pro", simulatorKey));
    // Native captures remain durable across app restarts. Replacing their
    // context epoch before the bridge validates them makes a valid receipt
    // appear to belong to a different operation and clears it on rejection.
    const pendingStatus = await SimpleAutomation.getStatus();
    const publishHistory = async () => {
      if (!operationContext.historyReady || !operationContext.jobId
        || !operationContext.companyId || !operationContext.driverId) return;
      const scope = {
        jobId: operationContext.jobId,
        companyId: operationContext.companyId,
        driverId: operationContext.driverId,
      };
      await SimpleAutomation.updateOperationHistory({
        ...scope,
        confirmedTripCount: Math.max(0, Number(operationContext.confirmedTripCount || 0)),
        jobProgress: Math.max(0, Number(operationContext.confirmedTripCount || 0)),
        trips: toProOperationHistoryRows(operationContext.historyTrips || [], scope),
      }).catch(error => console.warn("[NVU-Pro] histórico local indisponível", error));
    };
    if (pendingStatus.simpleState === "CAPTURE_CAPTURED" && pendingStatus.receiptText) {
      const sameJob = String(pendingStatus.captureJobId || "") === String(operationContext.jobId || "");
      return {
        status: "failed",
        message: sameJob
          ? "Existe uma captura Pro pendente. Abra a NVU e aguarde a validação antes de iniciar outro trabalho."
          : "Existe uma captura Pro de outra operação. Volte à operação anterior para validar ou cancele a captura no menu NVU antes de iniciar outra.",
      };
    }
    if (pendingStatus.running) {
      const sameOperation = pendingStatus.simulatorKey === simulator.key
        && String(pendingStatus.jobId || "") === String(operationContext.jobId || "")
        && String(pendingStatus.companyId || "") === String(operationContext.companyId || "")
        && String(pendingStatus.driverId || "") === String(operationContext.driverId || "")
        && String(pendingStatus.contractId || "") === String(operationContext.contractId || "");
      if (!sameOperation) {
        return { status: "failed", message: "O Modo Pro já está ativo em outra operação. Encerre essa sessão antes de iniciar outra." };
      }
      if (pendingStatus.simpleState === "CAPTURE_PENDING") {
        return { status: "failed", message: "A captura desta viagem ainda está em andamento. Aguarde a validação antes de retomar." };
      }
      const temporaryProjection = await ProOverlayProbe.getStatus().catch(() => null);
      if (pendingStatus.persistentOverlayPermission || temporaryProjection?.active) {
        // Keep the original context epoch, trip and receipt state. Reopening the
        // simulator does not require a new projection or a new Pro service.
        await publishHistory();
        const resumed = await SimpleAutomation.openSimulator({ packageId: simulator.packageId });
        return resumed.status === "opened"
          ? { status: "opened" }
          : resumed.status === "not-installed"
            ? { status: "not-installed" }
            : { status: "failed", message: "Não foi possível retomar o simulador da operação Pro." };
      }
    }
    const contextEpoch = `${simulator.key}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    // Launch with the last known list. Refresh from Firestore in parallel so a
    // cold/offline city lookup cannot hold the Android overlay or simulator.
    const launchCities = getCachedSimpleAutomationCities(simulatorKey);
    const citiesRefresh = loadSimpleAutomationCities(simulatorKey);
    await SimpleAutomation.setContext({
      simulatorKey: simulator.key,
      simulatorCode: simulator.simulatorCode,
      simulatorLabel: simulator.label,
      contextEpoch,
      companyName: companyName.trim() || "Empresa",
      operationName: operationContext.operationName || "",
      contractName: operationContext.contractName || "",
      jobId: operationContext.jobId || "",
      contractId: operationContext.contractId || "",
      companyId: operationContext.companyId || "",
      driverId: operationContext.driverId || "",
      confirmedTripCount: Math.max(0, Number(operationContext.confirmedTripCount || 0)),
      jobProgress: Math.max(0, Number(operationContext.confirmedTripCount || 0)),
      jobTotalDeliveries: Math.max(0, Number(operationContext.jobTotalDeliveries || 0)),
      jobStatus: operationContext.jobStatus || "",
      operationClosed: Boolean(operationContext.operationClosed),
      vehicleName: operationContext.vehicleName || "",
      trailerName: operationContext.trailerName || "",
      packageId: simulator.packageId,
      // An absent list means "use the native list for this same simulator".
      // An authoritative empty server list is applied by the async refresh.
      cities: (launchCities.length ? launchCities : cities).length
        ? (launchCities.length ? launchCities : cities).map(city => city.name)
      : undefined,
    });
    await publishHistory();
    recordSimpleAutomationProTiming("pro_context_ready", Date.now() - launchStartedAt);
    void citiesRefresh.then(fresh => SimpleAutomation.updateCities({
      contextEpoch,
      cities: fresh.map(city => city.name),
    })).catch(error => {
      console.warn("[NVU] As cidades serão atualizadas na próxima conexão", error);
    });

    const started = await SimpleAutomation.start();
    recordSimpleAutomationProTiming("pro_service_dispatched", Date.now() - launchStartedAt);
    if (started.status === "overlay-permission") {
      explainOverlayPermissionBeforeSettings();
      await SimpleAutomation.openOverlaySettings();
      return { status: "overlay-permission" };
    }
    if (started.status !== "started") {
      return { status: "failed", message: "A bolha do Modo Pro não iniciou." };
    }

    const opened = await SimpleAutomation.openSimulator({ packageId: simulator.packageId });
    if (opened.status === "not-installed") {
      await SimpleAutomation.stop();
      return { status: "not-installed" };
    }
    if (opened.status !== "opened") {
      await SimpleAutomation.stop();
      return { status: "failed", message: "O simulador não pôde ser aberto." };
    }
    recordSimpleAutomationProTiming("pro_simulator_opened", Date.now() - launchStartedAt);
    return { status: "opened" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro nativo desconhecido.";
    console.error("[NVU] Falha ao iniciar Modo Pro", error);
    return { status: "failed", message };
  }
}

export function simpleAutomationStatusMessage(status: SimpleAutomationLaunchResult): string {
  switch (status.status) {
    case "not-native":
      return "O Modo Pro precisa do aplicativo Android NVU.";
    case "module-missing":
      return "Este APK ainda não possui o módulo Pro atualizado.";
    case "overlay-permission":
      return "Após autorizar a sobreposição no Android, volte à NVU e toque novamente em Iniciar trabalho.";
    case "not-installed":
      return "O simulador selecionado não está instalado neste aparelho.";
    case "opened":
      return "Modo Pro iniciado.";
    default:
      return status.message;
  }
}
