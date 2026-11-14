export type CanonicalSimulatorCode = "GTO" | "WTDS" | "WBDS" | "TOE3";

export interface SimulatorCurrencyRegistryEntry {
  simulator: CanonicalSimulatorCode;
  currency: "BRL" | "EUR";
  aliases: readonly string[];
}

/** Product-owner-approved compatibility rule for historical records. */
export const SIMULATOR_CURRENCY_REGISTRY: readonly SimulatorCurrencyRegistryEntry[] = [
  { simulator: "GTO", currency: "BRL", aliases: ["GTO", "GLOBAL TRUCK", "GLOBAL TRUCK ONLINE", "COM.STARGAMESAPPS.GTO"] },
  { simulator: "WTDS", currency: "BRL", aliases: ["WTDS", "WORLD TRUCK DRIVING SIMULATOR"] },
  { simulator: "WBDS", currency: "BRL", aliases: ["WBDS", "WORLD BUS DRIVING SIMULATOR"] },
  { simulator: "TOE3", currency: "EUR", aliases: ["TOE3", "TOE 3", "TRUCKERS OF EUROPE 3"] },
] as const;

const simulatorFields = [
  "simulatorId", "simulatorCode", "simulatorKey", "simulatorName", "simulator",
  "simuladorId", "simuladorCodigo", "simuladorKey", "simuladorNome", "simulador",
  "gameId", "gameCode", "gameName", "packageId",
] as const;

function normalizeSimulatorAlias(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const aliasIndex = new Map<string, SimulatorCurrencyRegistryEntry>();
for (const entry of SIMULATOR_CURRENCY_REGISTRY) {
  for (const alias of entry.aliases) aliasIndex.set(normalizeSimulatorAlias(alias), entry);
}

export interface SimulatorCurrencyResolution {
  currency?: "BRL" | "EUR";
  simulator?: CanonicalSimulatorCode;
  status: "known" | "unknown" | "conflict";
  currencySource: "SIMULATOR_REGISTRY" | "SIMULATOR_UNRECOGNIZED" | "SIMULATOR_METADATA_CONFLICT";
  observedSimulatorFields: string[];
}

/** Resolve only exact recognized product identifiers; no locale or values are consulted. */
export function resolveSimulatorCurrency(trip: Record<string, unknown>): SimulatorCurrencyResolution {
  const observed = simulatorFields.flatMap((field) => {
    const raw = String(trip[field] ?? "").trim();
    return raw ? [{ field, entry: aliasIndex.get(normalizeSimulatorAlias(raw)) }] : [];
  });
  const recognized = [...new Map(observed.filter((item) => item.entry)
    .map((item) => [item.entry!.simulator, item.entry!])).values()];
  const observedSimulatorFields = observed.map((item) => item.field);

  if (recognized.length > 1) {
    return { status: "conflict", currencySource: "SIMULATOR_METADATA_CONFLICT", observedSimulatorFields };
  }
  if (recognized.length === 1) {
    return {
      simulator: recognized[0]!.simulator,
      currency: recognized[0]!.currency,
      status: "known",
      currencySource: "SIMULATOR_REGISTRY",
      observedSimulatorFields,
    };
  }
  return { status: "unknown", currencySource: "SIMULATOR_UNRECOGNIZED", observedSimulatorFields };
}

export function normalizeExplicitCurrency(value: unknown): { currency?: string; recognized: boolean; supported: boolean; ambiguous: boolean } {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return { recognized: false, supported: false, ambiguous: false };
  if (raw === "R$" || raw === "R$ BRL") return { currency: "BRL", recognized: true, supported: true, ambiguous: false };
  if (raw === "€") return { currency: "EUR", recognized: true, supported: true, ambiguous: false };
  if (raw === "US$") return { currency: "USD", recognized: true, supported: true, ambiguous: false };
  if (raw === "$") return { recognized: false, supported: false, ambiguous: true };
  const isoLike = /^[A-Z]{3}$/.test(raw);
  const supported = new Set(["BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG"]);
  const recognizedCodes = new Set(["BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG", "CAD", "AUD", "NZD", "JPY", "CNY", "CHF", "INR"]);
  if (isoLike && recognizedCodes.has(raw)) return { currency: raw, recognized: true, supported: supported.has(raw), ambiguous: false };
  return { recognized: false, supported: false, ambiguous: false };
}
