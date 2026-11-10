import { isCompanyListable } from "./companyCatalog";
import { resolveSimulatorId } from "./resolveSimulator";
import { resolveSimulatorDisplayLabel } from "./simulatorOptions";

type Row = Record<string, any>;

export type PartnerCandidate = {
  id: string; name: string; logo: string; simulatorLabel: string;
  /** Já houve oferta entre as duas empresas (a mais recente primeiro). */
  partnered: boolean; lastAt: number;
};
export type PartnerCandidates = {
  /** Simulador da empresa logada (canônico). Vazio = não foi possível identificar. */
  simulatorId: string; simulatorLabel: string; list: PartnerCandidate[];
};

const nameOf = (company: Row): string => String(company.companyName || company.fleetName || company.name || company.nome || "").trim();
const logoOf = (company: Row): string => String(company.logoUrl || company.logoURL || company.companyLogoURL || "").trim();

/**
 * Empresas que podem receber uma oferta de parceria: ATIVAS no sistema (mesma regra da tela "Empresas": não excluída, não
 * arquivada/suspensa/inativa), de OUTRA empresa e do MESMO simulador da empresa logada — comparado pela identidade
 * canônica do simulador (GTO = Global Truck Online etc.), como o resto do app. O servidor repete essas regras ao enviar.
 */
export function partnerCandidates(input: {
  ownCompany: Row | null | undefined; allCompanies: Row[]; simulators: Row[];
  history: { contractorCompanyId: string; executorCompanyId: string; updatedAtMs: number }[];
}): PartnerCandidates {
  const { ownCompany, allCompanies, simulators, history } = input;
  if (!ownCompany) return { simulatorId: "", simulatorLabel: "", list: [] };
  const simulatorId = resolveSimulatorId(ownCompany, simulators, allCompanies);
  if (!simulatorId || simulatorId === "all") return { simulatorId: "", simulatorLabel: "", list: [] };
  const simulatorLabel = resolveSimulatorDisplayLabel(ownCompany, simulators, allCompanies);
  const lastWith = new Map<string, number>();
  for (const row of history) {
    const other = row.contractorCompanyId === ownCompany.id ? row.executorCompanyId : row.executorCompanyId === ownCompany.id ? row.contractorCompanyId : "";
    if (other) lastWith.set(other, Math.max(lastWith.get(other) || 0, row.updatedAtMs || 1));
  }
  const seen = new Set<string>();
  const list: PartnerCandidate[] = [];
  for (const company of allCompanies) {
    const id = String(company.id || "");
    if (!id || id === ownCompany.id || seen.has(id) || !isCompanyListable(company) || !nameOf(company)) continue;
    if (resolveSimulatorId(company, simulators, allCompanies) !== simulatorId) continue;
    seen.add(id);
    list.push({ id, name: nameOf(company), logo: logoOf(company), simulatorLabel: resolveSimulatorDisplayLabel(company, simulators, allCompanies) || simulatorLabel,
      partnered: lastWith.has(id), lastAt: lastWith.get(id) || 0 });
  }
  return { simulatorId, simulatorLabel, list: list.sort((a, b) => Number(b.partnered) - Number(a.partnered) || b.lastAt - a.lastAt || a.name.localeCompare(b.name, "pt-BR", { numeric: true })) };
}
