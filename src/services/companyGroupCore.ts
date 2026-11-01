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
  skipped: Array<{ simulatorId: string; reason: string }>;
};
/** Accepts only a well-formed answer for this company. */
export function parseAddResult(data: any, companyId: string): AddResult | null {
  if (!data || data.success !== true || data.companyId !== companyId || !Array.isArray(data.created)) return null;
  const rows = (value: unknown) => (Array.isArray(value) ? value : []).filter((row: any) => row && typeof row.simulatorId === "string")
    .map((row: any) => ({ companyId: String(row.companyId || ""), simulatorId: row.simulatorId, simulatorName: String(row.simulatorName || row.simulatorId) }));
  return { created: rows(data.created), existing: rows(data.existing),
    skipped: (Array.isArray(data.skipped) ? data.skipped : []).filter((row: any) => row && typeof row.simulatorId === "string").map((row: any) => ({ simulatorId: row.simulatorId, reason: String(row.reason || "") })) };
}
export function isRenameAcknowledged(data: any, companyName: string): boolean {
  return Boolean(data && data.success === true && typeof data.companyName === "string" && data.companyName === companyName);
}

const joinNames = (names: string[]) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
export function addSummary(result: AddResult): string {
  const done = [...result.created, ...result.existing].map(row => row.simulatorName);
  if (!done.length) return result.skipped.length ? "Esses simuladores já fazem parte da empresa." : "Nenhum simulador foi adicionado.";
  return `${joinNames(done)} ${done.length === 1 ? "foi adicionado" : "foram adicionados"} à empresa.`;
}

export function groupFailureMessage(error: any): string {
  switch (String(error?.details?.reasonCode || "")) {
    case "GROUP_OWNER_ONLY": return "Somente o proprietário da empresa pode fazer isso.";
    case "GROUP_ACCOUNT_UNAVAILABLE": return "Sua conta está indisponível no momento.";
    case "GROUP_COMPANY_UNAVAILABLE": return "A empresa não está disponível.";
    case "GROUP_NO_SIMULATOR": return "Escolha ao menos um simulador.";
    case "GROUP_NAME_REQUIRED": return "O nome da empresa é obrigatório.";
    case "GROUP_NAME_TOO_LONG": return "O nome da empresa é longo demais.";
  }
  const reference = text(error?.details?.diagnosticId);
  const suffix = reference ? ` Referência: ${reference}.` : "";
  if (["unavailable", "deadline-exceeded", "internal", "unknown"].includes(codeOf(error)))
    return `Não foi possível concluir agora. Nada foi perdido: tente novamente.${suffix}`;
  return `Não foi possível concluir.${suffix}`;
}
