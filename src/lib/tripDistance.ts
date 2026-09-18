export type SimulatorSource = string | Record<string, unknown> | null | undefined;

const DISTANCE_SIMULATOR_CODES = new Set(["ATS", "ETS2", "TOE3"]);

const readText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Converts simulator labels and legacy aliases to a stable comparison token.
 * Firestore document IDs may be opaque, so the simulator catalog name is
 * checked before the raw simulatorId whenever a catalog entry is available.
 */
export const normalizeTripSimulatorCode = (value: unknown): string => {
  const compact = readText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!compact) return "";

  if (compact === "ATS" || compact.includes("AMERICANTRUCKSIMULATOR")) {
    return "ATS";
  }

  if (
    compact === "ETS2" ||
    compact.includes("EUROTRUCKSIMULATOR2")
  ) {
    return "ETS2";
  }

  if (
    compact === "TOE3" ||
    compact.includes("TRUCKERSOFEUROPE3")
  ) {
    return "TOE3";
  }

  if (compact === "GTO" || compact === "GLOBALTRUCK" || compact.includes("GLOBALTRUCKONLINE")) {
    return "GTO";
  }

  return compact;
};

export const resolveTripSimulatorCode = (
  source: SimulatorSource,
  simulators: Array<Record<string, unknown>> = [],
): string => {
  if (typeof source === "string") {
    return normalizeTripSimulatorCode(source);
  }

  if (!source || typeof source !== "object") return "";

  const simulatorId = readText(
    source.simulatorId ?? source.simuladorId ?? source.simulator_id,
  );

  const catalogMatch = simulatorId
    ? simulators.find((simulator) => readText(simulator.id) === simulatorId)
    : undefined;

  const candidates: unknown[] = [
    catalogMatch?.name,
    catalogMatch?.simulatorName,
    source.simulatorName,
    source.simuladorNome,
    source.simulator,
    source.simulador,
    catalogMatch?.id,
    simulatorId,
  ];

  for (const candidate of candidates) {
    const code = normalizeTripSimulatorCode(candidate);
    if (code) return code;
  }

  return "";
};

export const requiresTripDistance = (
  source: SimulatorSource,
  simulators: Array<Record<string, unknown>> = [],
): boolean => DISTANCE_SIMULATOR_CODES.has(resolveTripSimulatorCode(source, simulators));

export const parseTripDistance = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;

  let normalized = cleaned;
  const hasComma = cleaned.includes(",");
  const dotCount = (cleaned.match(/\./g) || []).length;
  const hasDot = dotCount > 0;

  if (hasComma && hasDot) {
    // Accept both pt-BR (1.234,56) and en-US (1,234.56) input.
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    // The form is presented in pt-BR, where comma is the decimal separator.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const groups = cleaned.split(".");
    const looksLikePtBrThousands =
      groups.length > 1 &&
      groups[0].length >= 1 &&
      groups.slice(1).every((group) => group.length === 3);

    if (looksLikePtBrThousands) {
      // OCR values were being formatted with toLocaleString("pt-BR"). A value
      // such as 1.234 km must therefore be saved as 1234, not 1.234 km.
      normalized = cleaned.replace(/\./g, "");
    } else if (dotCount > 1) {
      const lastDot = cleaned.lastIndexOf(".");
      normalized =
        cleaned.slice(0, lastDot).replace(/\./g, "") + cleaned.slice(lastDot);
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Formats a distance for the editable form without a thousands separator.
 * This keeps the value unambiguous when it is parsed again on submit.
 */
export const formatTripDistanceInput = (distance: number): string =>
  new Intl.NumberFormat("pt-BR", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(distance);

export const readTripDistance = (trip: Record<string, unknown> | null | undefined): number =>
  parseTripDistance(
    trip?.distanciaPercorrida ??
      trip?.distanceTraveled ??
      trip?.distanceKm ??
      trip?.distancia,
  );

export const formatTripDistance = (distance: number): string =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(distance);
