export type ProSimulatorKey = "wtds" | "wbds" | "toe-3" | "global-truck";

export type ProVisibility = "VISIBLE" | "OUTSIDE" | "UNKNOWN";
export type ProProjectionState = "NOT_GRANTED" | "PENDING" | "GRANTED" | "REVOKED";

export type ProSessionState =
  | "IDLE"
  | "CONTEXT_READY"
  | "SIMULATOR_VISIBLE"
  | "ROUTE_SELECTING"
  | "TRIP_ACTIVE"
  | "CAPTURE_AUTH_PENDING"
  | "CAPTURING"
  | "OCR_VALIDATING"
  | "SUBMITTING"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

export type ProCaptureFailureCode =
  | "SESSION_MISSING"
  | "ROUTE_MISSING"
  | "ROUTE_INVALID"
  | "CONTEXT_NOT_ALLOWED"
  | "CONTEXT_MISMATCH"
  | "FOREGROUND_MISMATCH"
  | "PROJECTION_PERMISSION_PENDING"
  | "PROJECTION_DENIED"
  | "RESULT_SCREEN_UNCONFIRMED"
  | "RECEIPT_POLICY_REJECTED"
  | "DUPLICATE_TRIP";

export type ProSimulatorCode = "GTO" | "TOE3" | "WTDS" | "WBDS";

export type ProSimulatorDefinition = {
  key: ProSimulatorKey;
  /** Canonical persisted/displayed acronym. Never use label for trip records. */
  simulatorCode: ProSimulatorCode;
  /** Optional marketing name for configuration surfaces only. */
  label: string;
  /** Backward-compatible alias; always equal to simulatorCode. */
  shortLabel: ProSimulatorCode;
  packageId: string;
  capabilities: {
    trailer: boolean;
    euroCurrency: boolean;
    bonusLabel: "video_ads" | "percentage_offer";
    requiresResultScreenOcr: true;
  };
  resultScreen: {
    titleMarkers: readonly string[];
    amountLabels: readonly string[];
    bonusLabels: readonly string[];
    requiredMarkers: readonly string[];
  };
  locale: {
    decimalSeparator: "," | ".";
    thousandsSeparator: "." | "," | "";
    currency: "BRL" | "EUR";
  };
};

export const PRO_SIMULATOR_REGISTRY: readonly ProSimulatorDefinition[] = [
  {
    key: "wtds",
    simulatorCode: "WTDS",
    label: "World Truck Driving Simulator",
    shortLabel: "WTDS",
    packageId: "com.dynamicgames.worldtruckdrivingsimulator",
    capabilities: { trailer: true, euroCurrency: false, bonusLabel: "video_ads", requiresResultScreenOcr: true },
    resultScreen: {
      titleMarkers: ["resultados", "ganhos", "viagem"],
      amountLabels: ["ganhos da viagem", "total"],
      bonusLabels: ["bonus video ads", "bônus video ads"],
      requiredMarkers: ["danos", "combustível"],
    },
    locale: { decimalSeparator: ",", thousandsSeparator: ".", currency: "BRL" },
  },
  {
    key: "wbds",
    simulatorCode: "WBDS",
    label: "World Bus Driving Simulator",
    shortLabel: "WBDS",
    packageId: "com.dynamicgames.worldbusdrivingsimulator",
    capabilities: { trailer: false, euroCurrency: false, bonusLabel: "video_ads", requiresResultScreenOcr: true },
    resultScreen: {
      titleMarkers: ["resultados", "ganhos", "viagem"],
      amountLabels: ["ganhos da viagem", "total"],
      bonusLabels: ["bonus video ads", "bônus video ads"],
      requiredMarkers: ["danos", "combustível"],
    },
    locale: { decimalSeparator: ",", thousandsSeparator: ".", currency: "BRL" },
  },
  {
    key: "toe-3",
    simulatorCode: "TOE3",
    label: "Truckers of Europe 3",
    shortLabel: "TOE3",
    packageId: "com.WandaSoftware.TruckersofEurope3",
    capabilities: { trailer: true, euroCurrency: true, bonusLabel: "percentage_offer", requiresResultScreenOcr: true },
    resultScreen: {
      titleMarkers: ["resultados", "renda total", "continuar"],
      amountLabels: ["renda total", "ganhos"],
      bonusLabels: ["bônus de", "bonus de", "remover penalidades"],
      requiredMarkers: ["distância", "tempo gasto"],
    },
    locale: { decimalSeparator: ",", thousandsSeparator: ".", currency: "EUR" },
  },
  {
    key: "global-truck",
    simulatorCode: "GTO",
    label: "Global Truck Online",
    shortLabel: "GTO",
    packageId: "com.stargamesapps.gto",
    capabilities: { trailer: true, euroCurrency: false, bonusLabel: "video_ads", requiresResultScreenOcr: true },
    resultScreen: {
      titleMarkers: ["concluído", "valor a receber", "receber"],
      amountLabels: ["valor a receber"],
      bonusLabels: ["bonus video ads", "bônus video ads", "dobrar valor"],
      requiredMarkers: ["concluído"],
    },
    locale: { decimalSeparator: ",", thousandsSeparator: ".", currency: "BRL" },
  },
];

export type ProAllowedContext = {
  contextEpoch: string;
  simulatorKey: ProSimulatorKey;
  expectedPackage: string;
  companyId: string;
  jobId: string;
  contractId: string;
  operationName: string;
  createdAt: number;
};

export type ProSessionSnapshot = {
  sessionId: string;
  contextEpoch: string;
  state: ProSessionState;
  simulatorKey: ProSimulatorKey;
  expectedPackage: string;
  origin: string;
  destination: string;
  tripStartedAt: number;
  visibility: ProVisibility;
  projection: ProProjectionState;
  attemptId: string;
  lastFailureCode?: ProCaptureFailureCode;
};

export type ProReceiptEvidence = {
  simulatorKey: ProSimulatorKey;
  amountCents: number;
  currency: "BRL" | "EUR";
  baseReceiptFound: boolean;
  resultScreenConfirmed: boolean;
  bonusEvidence: "NONE" | "ZERO_LABEL" | "POSITIVE" | "DUPLICATED" | "OFFER_ONLY";
  confidence: number;
};

export function getProSimulatorDefinition(key: unknown): ProSimulatorDefinition | undefined {
  return PRO_SIMULATOR_REGISTRY.find((definition) => definition.key === key);
}

export function getProSimulatorCode(key: unknown): ProSimulatorCode | undefined {
  return getProSimulatorDefinition(key)?.simulatorCode;
}

export function resolveProSimulatorCode(value: unknown): ProSimulatorCode | undefined {
  const normalized = String(value || "")
    .trim()
    .toLocaleUpperCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  if (!normalized) return undefined;
  const match = PRO_SIMULATOR_REGISTRY.find((definition) => {
    const aliases = [
      definition.key,
      definition.simulatorCode,
      definition.shortLabel,
      definition.label,
      definition.packageId,
    ].map((candidate) => String(candidate).toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]+/g, " ").trim());
    return aliases.includes(normalized);
  });
  return match?.simulatorCode;
}

export function isAllowedProContext(context: Partial<ProAllowedContext>): boolean {
  const definition = getProSimulatorDefinition(context.simulatorKey);
  return Boolean(
    context.contextEpoch
      && context.expectedPackage
      && definition
      && definition.packageId === context.expectedPackage
      && context.jobId
      && context.companyId,
  );
}
