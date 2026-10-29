export type WorkMode = "print" | "pro" | "max";
export type SimulatorKey = "gto" | "wtds" | "wbds" | "toe3" | string;
export interface WorkModeAvailabilityMode { enabled: boolean; simulators: Record<string, boolean>; }
export interface WorkModeAvailability {
  version: number;
  print: WorkModeAvailabilityMode;
  pro: WorkModeAvailabilityMode;
  max: WorkModeAvailabilityMode;
  updatedAt?: unknown;
  updatedBy?: string;
}

const DEFAULTS: Record<string, string> = { gto: "GTO", wtds: "WTDS", wbds: "WBDS", toe3: "TOE 3", ets2: "ETS2", ats: "ATS", pbs: "PBS" };
const ALIASES: Record<string, string[]> = {
  ets2: ["ets2", "eurotrucksimulator2"],
  ats: ["ats", "americantrucksimulator"],
  pbs: ["pbs", "protonbussimulator", "protonbussimulatorroad"],
  gto: ["gto", "globaltruck", "globaltruckonline", "global-truck-online"],
  wtds: ["wtds", "worldtruckdrivingsimulator"],
  wbds: ["wbds", "worldbusdrivingsimulator"],
  toe3: ["toe3", "truckersofeurope3", "truckers-of-europe-3"],
};

const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]+/g, "");
export function normalizeSimulatorKey(value: unknown): string | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  for (const [key, aliases] of Object.entries(ALIASES)) if (aliases.map(normalize).includes(normalized)) return key;
  return null;
}
export function getSimulatorLabel(value: unknown): string {
  const key = normalizeSimulatorKey(value) || "";
  if (DEFAULTS[key]) return DEFAULTS[key];
  return String(value ?? "").trim().split(/[\s_-]+/).filter(Boolean).map(part => part.length <= 4 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`).join(" ") || "Simulador";
}
export function createDefaultWorkModeAvailability(simulators: Array<any> = []): WorkModeAvailability {
  const result: WorkModeAvailability = { version: 0, print: { enabled: true, simulators: {} }, pro: { enabled: true, simulators: {} }, max: { enabled: true, simulators: {} } };
  const keys = new Set<string>(["gto", "wtds", "wbds", "toe3", "ets2", "ats", "pbs"]);
  simulators.forEach(sim => { const key = normalizeSimulatorKey(sim?.key ?? sim?.code ?? sim?.name ?? sim?.id); if (key) keys.add(key); });
  keys.forEach(key => { result.print.simulators[key] = true; result.pro.simulators[key] = true; result.max.simulators[key] = true; });
  return result;
}
function normalizeMode(value: any, simulatorKeys: string[]): WorkModeAvailabilityMode {
  const source = value && typeof value === "object" ? value : {};
  const simulators = source.simulators && typeof source.simulators === "object" ? source.simulators : {};
  const normalized: Record<string, boolean> = Object.fromEntries(simulatorKeys.map(key => [key, true]));
  for (const [rawKey, enabled] of Object.entries(simulators)) {
    const key = normalizeSimulatorKey(rawKey);
    if (key) normalized[key] = normalized[key] !== false && enabled !== false;
  }
  return { enabled: source.enabled !== false, simulators: normalized };
}
export function normalizeWorkModeAvailability(value: any, simulatorKeys: string[] = ["gto", "wtds", "wbds", "toe3", "ets2", "ats", "pbs"]): WorkModeAvailability {
  const source = value?.workModeAvailability && typeof value.workModeAvailability === "object" ? value.workModeAvailability : (value || {});
  const defaults = createDefaultWorkModeAvailability(simulatorKeys.map(id => ({ id })));
  return {
    version: Number.isInteger(Number(source.version)) && Number(source.version) >= 0 ? Number(source.version) : 0,
    print: normalizeMode(source.print, Object.keys(defaults.print.simulators)),
    pro: normalizeMode(source.pro, Object.keys(defaults.pro.simulators)),
    max: normalizeMode(source.max, Object.keys(defaults.max.simulators)),
    ...(source.updatedAt !== undefined ? { updatedAt: source.updatedAt } : {}),
    ...(typeof source.updatedBy === "string" ? { updatedBy: source.updatedBy } : {}),
  };
}

export const WORK_MODE_SIMULATORS: Record<WorkMode, string[]> = {
  print: ["gto", "wtds", "wbds", "toe3", "ets2", "ats", "pbs"],
  pro: ["gto", "wtds", "wbds", "toe3"],
  max: ["gto"],
};
export function isWorkModeAllowed(value: WorkModeAvailability, mode: WorkMode, simulator: unknown): boolean {
  const key = normalizeSimulatorKey(simulator);
  return Boolean(key && WORK_MODE_SIMULATORS[mode].includes(key) && value[mode].enabled && value[mode].simulators[key] !== false);
}
