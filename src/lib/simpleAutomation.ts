import { collectSimulatorAliases } from "./resolveSimulator";

export type SimpleAutomationSimulatorKey =
  | "wtds"
  | "wbds"
  | "toe-3"
  | "global-truck";

export type SimpleAutomationSimulatorCode = "GTO" | "TOE3" | "WTDS" | "WBDS";

export type SimpleAutomationSimulator = {
  key: SimpleAutomationSimulatorKey;
  simulatorCode: SimpleAutomationSimulatorCode;
  label: string;
  shortLabel: SimpleAutomationSimulatorCode;
  packageId: string;
  aliases: readonly string[];
};

/**
 * The simple mode deliberately has its own identity registry. In particular,
 * WTDS and WBDS are never merged, and Global Truck uses the simple-mode key
 * `global-truck` even though the legacy GTO mode has its own `gto` identity.
 */
export const SIMPLE_AUTOMATION_SIMULATORS: readonly SimpleAutomationSimulator[] = [
  {
    key: "wtds",
    simulatorCode: "WTDS",
    label: "World Truck Driving Simulator",
    shortLabel: "WTDS",
    packageId: "com.dynamicgames.worldtruckdrivingsimulator",
    aliases: ["wtds", "world truck driving simulator", "world-truck-driving-simulator"],
  },
  {
    key: "wbds",
    simulatorCode: "WBDS",
    label: "World Bus Driving Simulator",
    shortLabel: "WBDS",
    packageId: "com.dynamicgames.worldbusdrivingsimulator",
    aliases: ["wbds", "world bus driving simulator", "world-bus-driving-simulator"],
  },
  {
    key: "toe-3",
    simulatorCode: "TOE3",
    label: "Truckers of Europe 3",
    shortLabel: "TOE3",
    packageId: "com.WandaSoftware.TruckersofEurope3",
    aliases: ["toe 3", "toe3", "toe-3", "truckers of europe 3", "truckers-of-europe-3"],
  },
  {
    key: "global-truck",
    simulatorCode: "GTO",
    label: "Global Truck Online",
    shortLabel: "GTO",
    packageId: "com.stargamesapps.gto",
    aliases: ["gto", "global truck", "global-truck", "global truck online", "global-truck-online"],
  },
];

const normalizeAlias = (value: unknown): string =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const aliasesFor = (simulator: SimpleAutomationSimulator): Set<string> =>
  new Set(simulator.aliases.map(normalizeAlias));

export function getSimpleAutomationSimulator(
  value: unknown,
  simulatorCatalog: readonly unknown[] = [],
): SimpleAutomationSimulator | undefined {
  const candidates =
    value && typeof value === "object"
      ? [
          (value as Record<string, unknown>).simpleAutomationSimulatorKey,
          (value as Record<string, unknown>).simulatorKey,
          (value as Record<string, unknown>).simulatorId,
          (value as Record<string, unknown>).simuladorId,
          (value as Record<string, unknown>).simulatorName,
          (value as Record<string, unknown>).simuladorNome,
          (value as Record<string, unknown>).targetSimulator,
          (value as Record<string, unknown>).simulator,
          (value as Record<string, unknown>).simulador,
        ]
      : [value];

  const direct = candidates
    .map(normalizeAlias)
    .filter(Boolean)
    .reduce<SimpleAutomationSimulator | undefined>((found, candidate) => {
      if (found) return found;
      return SIMPLE_AUTOMATION_SIMULATORS.find((simulator) => {
        const aliases = aliasesFor(simulator);
        return simulator.key === candidate || aliases.has(candidate);
      });
    }, undefined);
  if (direct) return direct;

  // Company documents can contain only an opaque simulator document ID. Match
  // that ID against the catalog before deciding that the operation is GTO.
  const valueAliases = collectSimulatorAliases(value, true);
  if (!valueAliases.size) return undefined;
  for (const catalogEntry of simulatorCatalog) {
    const catalogAliases = collectSimulatorAliases(catalogEntry, true);
    if (!catalogAliases.size) continue;
    const sharesIdentity = Array.from(valueAliases).some((alias) => catalogAliases.has(alias));
    if (!sharesIdentity) continue;
    const resolved = getSimpleAutomationSimulator(catalogEntry);
    if (resolved) return resolved;
  }

  return undefined;
}

export function normalizeSimpleAutomationSimulatorKey(
  value: unknown,
): SimpleAutomationSimulatorKey | undefined {
  return getSimpleAutomationSimulator(value)?.key;
}

export type SimpleAutomationCity = {
  id: string;
  name: string;
  initial: string;
};

export const normalizeSimpleCityName = (value: unknown): string =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);

export function cityInitial(value: unknown): string {
  const normalized = normalizeSimpleCityName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return normalized ? normalized.charAt(0).toLocaleUpperCase("pt-BR") : "";
}

export function cityId(value: unknown): string {
  return normalizeSimpleCityName(value)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function sanitizeSimpleAutomationCities(
  values: unknown,
): SimpleAutomationCity[] {
  const raw = Array.isArray(values)
    ? values
    : values && typeof values === "object" && Array.isArray((values as { cities?: unknown }).cities)
      ? (values as { cities: unknown[] }).cities
      : [];

  const byId = new Map<string, SimpleAutomationCity>();
  raw.forEach((entry) => {
    const name = normalizeSimpleCityName(
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? (entry as { name?: unknown }).name
          : "",
    );
    const id = cityId(name);
    const initial = cityInitial(name);
    if (!name || !id || !initial || byId.has(id)) return;
    byId.set(id, { id, name, initial });
  });

  return Array.from(byId.values()).sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
  );
}

export function simpleCityInitials(
  cities: readonly SimpleAutomationCity[],
): string[] {
  return Array.from(new Set(cities.map((city) => city.initial).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "pt-BR"),
  );
}

export function filterSimpleAutomationCities(
  cities: readonly SimpleAutomationCity[],
  initial: string | null | undefined,
): SimpleAutomationCity[] {
  const normalizedInitial = String(initial || "").trim().toLocaleUpperCase("pt-BR");
  if (!normalizedInitial) return [...cities];
  return cities.filter((city) => city.initial === normalizedInitial);
}
