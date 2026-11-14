/**
 * One company, several simulators: everything that can be decided without the network. The server stays the authority
 * (owner check, catalog check, no duplicates); this module only finds the fleets of a group, lists what can still be
 * added, and words the outcome.
 */
import { resolveSimulatorDisplayLabel } from "../lib/simulatorOptions";
import { resolveSimulatorId } from "../lib/resolveSimulator";

type Row = Record<string, any>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** A fleet that is gone, archived or switched off does not count as a simulator of the company. */
export function isUsableFleet(company: Row | null | undefined): boolean {
  if (!company) return false;
  if (company.deleted === true || company.isDeleted === true || company.softDeleted === true) return false;
  if (company.active === false || company.isActive === false) return false;
  return !["deleted", "archived", "disabled", "blocked", "pending", "rejected", "suspended", "inactive"].includes(text(company.status || "active").toLowerCase());
}

/** The id the fleets of one company share: the group id, or (before any simulator was added) the fleet's own id. */
export const companyGroupIdOf = (company: Row | null | undefined) => company ? text(company.companyGroupId) || text(company.id) : "";

/** Fleets of the same company as `active` among the ones the user can see, the active one first. */
export function fleetsOfGroup(active: Row | null | undefined, companies: Row[]): Row[] {
  if (!active) return [];
  const groupId = companyGroupIdOf(active);
  const members = (Array.isArray(companies) ? companies : []).filter(company => company?.id !== active.id
    && isUsableFleet(company) && (text(company.companyGroupId) === groupId || text(company.id) === groupId));
  return [active, ...members.sort((a, b) => text(a.simulatorName).localeCompare(text(b.simulatorName), "pt-BR"))];
}

export type GroupSimulatorRow = { companyId: string; label: string; current: boolean };
export function groupSimulatorRows(active: Row | null | undefined, companies: Row[], simulators: Row[]): GroupSimulatorRow[] {
  return fleetsOfGroup(active, companies).map(company => ({
    companyId: String(company.id), current: company.id === active?.id,
    label: resolveSimulatorDisplayLabel(company, simulators as any[], companies as any[]) || text(company.simulatorName) || "Simulador",
  }));
}

/** Active catalog simulators the company does not have yet, in the catalog's order. */
export function simulatorsToAdd(active: Row | null | undefined, companies: Row[], simulators: Row[]): Array<{ value: string; label: string }> {
  const have = new Set(fleetsOfGroup(active, companies).map(company => resolveSimulatorId(company, simulators as any[], companies as any[])).filter(Boolean));
  return (Array.isArray(simulators) ? simulators : [])
    .filter(simulator => simulator?.active !== false && text(simulator?.id) && text(simulator?.name))
    .filter(simulator => !have.has(resolveSimulatorId(simulator, simulators as any[], companies as any[])) && !have.has(String(simulator.id)))
    .map(simulator => ({ value: String(simulator.id), label: text(simulator.name) }));
}

export function parseGroupCapabilities(data: any): string[] {
  if (!data || data.success !== true || !Array.isArray(data.capabilities)) return [];
  return data.capabilities.filter((item: unknown): item is string => typeof item === "string");
}

const codeOf = (error: any) => String(error?.code || "").replace(/^functions\//, "");
/** A server published before this feature answers "invalid action" or "not found": the option stays hidden. */
export function isGroupUnsupported(error: unknown): boolean {
  const code = codeOf(error);
  return code === "invalid-argument" || code === "not-found" || code === "unimplemented";
}

export type AddResult = {
  created: Array<{ companyId: string; simulatorId: string; simulatorName: string }>;
  existing: Array<{ companyId: string; simulatorId: string; simulatorName: string }>;
  /** Simulators the company had switched off and that came back as they were. */
  reactivated: Array<{ companyId: string; simulatorId: string; simulatorName: string }>;
  skipped: Array<{ simulatorId: string; reason: string }>;
};
/** Accepts only a well-formed answer for this company. */
export function parseAddResult(data: any, companyId: string): AddResult | null {
  if (!data || data.success !== true || data.companyId !== companyId || !Array.isArray(data.created)) return null;
  const rows = (value: unknown) => (Array.isArray(value) ? value : []).filter((row: any) => row && typeof row.simulatorId === "string")
    .map((row: any) => ({ companyId: String(row.companyId || ""), simulatorId: row.simulatorId, simulatorName: String(row.simulatorName || row.simulatorId) }));
  return { created: rows(data.created), existing: rows(data.existing), reactivated: rows(data.reactivated),
    skipped: (Array.isArray(data.skipped) ? data.skipped : []).filter((row: any) => row && typeof row.simulatorId === "string").map((row: any) => ({ simulatorId: row.simulatorId, reason: String(row.reason || "") })) };
}
export function isRenameAcknowledged(data: any, companyName: string): boolean {
  return Boolean(data && data.success === true && typeof data.companyName === "string" && data.companyName === companyName);
}

const joinNames = (names: string[]) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
export function addSummary(result: AddResult): string {
  const done = [...result.created, ...result.existing, ...(result.reactivated || [])].map(row => row.simulatorName);
  if (!done.length) return result.skipped.length ? "Esses simuladores já fazem parte da empresa." : "Nenhum simulador foi adicionado.";
  return `${joinNames(done)} ${done.length === 1 ? "foi adicionado" : "foram adicionados"} à empresa.`;
}

export type DeactivateResult = { deactivated: Array<{ companyId: string; simulatorId: string; simulatorName: string }>; alreadyInactive: string[]; remaining: number };
/** Accepts only a well-formed answer for this company. */
export function parseDeactivateResult(data: any, companyId: string): DeactivateResult | null {
  if (!data || data.success !== true || data.companyId !== companyId || !Array.isArray(data.deactivated)) return null;
  return {
    deactivated: data.deactivated.filter((row: any) => row && typeof row.companyId === "string")
      .map((row: any) => ({ companyId: row.companyId, simulatorId: String(row.simulatorId || ""), simulatorName: String(row.simulatorName || row.simulatorId || "") })),
    alreadyInactive: (Array.isArray(data.alreadyInactive) ? data.alreadyInactive : []).filter((id: unknown): id is string => typeof id === "string"),
    remaining: Number(data.remaining) || 0,
  };
}
export function deactivateSummary(result: DeactivateResult): string {
  const names = result.deactivated.map(row => row.simulatorName).filter(Boolean);
  if (!names.length) return "Esses simuladores já estavam desativados.";
  return `${joinNames(names)} ${names.length === 1 ? "foi desativado" : "foram desativados"}. O histórico fica guardado.`;
}

/**
 * "Simuladores de atuação" of the edit form: every active catalog simulator is an option, and the ones the company has
 * (one usable fleet each) are the chosen ones. `fleetByValue` tells which fleet a chosen value belongs to, so that
 * unchecking it can switch that fleet off.
 */
export function groupSimulatorSelection(active: Row | null | undefined, companies: Row[], simulators: Row[]) {
  const fleets = fleetsOfGroup(active, companies);
  const fleetByValue = new Map<string, string>();
  const labels = new Map<string, string>();
  fleets.forEach(fleet => {
    const catalog = (Array.isArray(simulators) ? simulators : []).find(simulator => text(simulator?.id) &&
      (resolveSimulatorId(simulator, simulators as any[], companies as any[]) === resolveSimulatorId(fleet, simulators as any[], companies as any[]) || String(simulator.id) === text(fleet.simulatorId)));
    const value = catalog ? String(catalog.id) : text(fleet.simulatorId) || resolveSimulatorId(fleet, simulators as any[], companies as any[]);
    if (!value) return;
    fleetByValue.set(value, String(fleet.id));
    labels.set(value, resolveSimulatorDisplayLabel(fleet, simulators as any[], companies as any[]) || text(fleet.simulatorName) || value);
  });
  const options = (Array.isArray(simulators) ? simulators : [])
    .filter(simulator => text(simulator?.id) && text(simulator?.name) && (simulator.active !== false || fleetByValue.has(String(simulator.id))))
    .map(simulator => ({ value: String(simulator.id), label: text(simulator.name) }));
  // A simulator the company has but the catalog no longer lists still shows as a chosen option.
  fleetByValue.forEach((_, value) => { if (!options.some(option => option.value === value)) options.push({ value, label: labels.get(value) || value }); });
  const currentValue = [...fleetByValue.entries()].find(([, id]) => id === String(active?.id))?.[0] || "";
  return { options, selected: [...fleetByValue.keys()], fleetByValue, currentValue };
}

/** What saving the form changes: simulators to switch on, and fleets to switch off. */
export function simulatorChanges(selection: { selected: string[]; fleetByValue: Map<string, string> }, next: string[]) {
  const wanted = new Set(next), had = new Set(selection.selected);
  return {
    add: next.filter(value => !had.has(value)),
    remove: selection.selected.filter(value => !wanted.has(value)).map(value => ({ value, companyId: selection.fleetByValue.get(value) || "" })).filter(item => item.companyId),
  };
}

export function groupFailureMessage(error: any): string {
  switch (String(error?.details?.reasonCode || "")) {
    case "GROUP_OWNER_ONLY": return "Somente o proprietário da empresa pode fazer isso.";
    case "GROUP_ACCOUNT_UNAVAILABLE": return "Sua conta está indisponível no momento.";
    case "GROUP_COMPANY_UNAVAILABLE": return "A empresa não está disponível.";
    case "GROUP_NO_SIMULATOR": return "Escolha ao menos um simulador.";
    case "GROUP_NAME_REQUIRED": return "O nome da empresa é obrigatório.";
    case "GROUP_NAME_TOO_LONG": return "O nome da empresa é longo demais.";
    case "GROUP_LAST_SIMULATOR": return "A empresa precisa continuar com pelo menos um simulador ativo.";
    case "GROUP_OPEN_OPERATIONS": return "Finalize ou cancele as operações desse simulador antes de desativá-lo. O histórico é preservado.";
    case "GROUP_NOT_IN_GROUP": return "Esse simulador não faz parte da empresa.";
  }
  const reference = text(error?.details?.diagnosticId);
  const suffix = reference ? ` Referência: ${reference}.` : "";
  if (["unavailable", "deadline-exceeded", "internal", "unknown"].includes(codeOf(error)))
    return `Não foi possível concluir agora. Nada foi perdido: tente novamente.${suffix}`;
  return `Não foi possível concluir.${suffix}`;
}
