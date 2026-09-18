import {
  getSimpleAutomationSimulator,
  type SimpleAutomationCity,
  type SimpleAutomationSimulatorKey,
} from "../lib/simpleAutomation";
import { getProLaunchAvailability } from "../lib/proLaunchAvailability";
import {
  isSimpleAutomationNativeAvailable,
  SimpleAutomation,
  type SimpleAutomationNativeStatus,
} from "../lib/simpleAutomationNative";

export type SimpleAutomationOperationContext = {
  companyId?: string;
  driverId?: string;
  jobId?: string;
  contractId?: string;
  operationName?: string;
  contractName?: string;
  jobProgress?: number;
  jobTotalDeliveries?: number;
  jobStatus?: string;
  operationClosed?: boolean;
  vehicleName?: string;
  trailerName?: string;
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
): Promise<SimpleAutomationLaunchResult> {
  const simulator = getSimpleAutomationSimulator(simulatorKey);
  if (!simulator) return { status: "failed", message: "Simulador Pro inválido." };

  const availability = getProLaunchAvailability({
    job: {
      status: operationContext.jobStatus,
      progress: operationContext.jobProgress,
    },
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
    const contextEpoch = `${simulator.key}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const context = await SimpleAutomation.setContext({
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
      jobProgress: Math.max(0, Number(operationContext.jobProgress || 0)),
      jobTotalDeliveries: Math.max(0, Number(operationContext.jobTotalDeliveries || 0)),
      jobStatus: operationContext.jobStatus || "",
      operationClosed: Boolean(operationContext.operationClosed),
      vehicleName: operationContext.vehicleName || "",
      trailerName: operationContext.trailerName || "",
      packageId: simulator.packageId,
      cities: cities.map((city) => city.name),
    });

    if (context.status === "overlay-permission") {
      await SimpleAutomation.openOverlaySettings();
      return { status: "overlay-permission" };
    }

    const started = await SimpleAutomation.start();
    if (started.status === "overlay-permission") {
      await SimpleAutomation.openOverlaySettings();
      return { status: "overlay-permission" };
    }
    if (started.status !== "started") {
      return { status: "failed", message: "A bolha do Modo Pro não iniciou." };
    }

    const opened = await SimpleAutomation.openSimulator({ packageId: simulator.packageId });
    if (opened.status === "not-installed") return { status: "not-installed" };
    if (opened.status !== "opened") {
      return { status: "failed", message: "O simulador não pôde ser aberto." };
    }
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
      return "Permita a sobreposição da NVU e toque novamente para iniciar.";
    case "not-installed":
      return "O simulador selecionado não está instalado neste aparelho.";
    case "opened":
      return "Modo Pro iniciado.";
    default:
      return status.message;
  }
}
