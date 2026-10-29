import { collectSimulatorAliases } from "./resolveSimulator";
import { isOpaqueSimulatorCode, resolveSimulatorDisplayLabel } from "./simulatorOptions";

type RecordLike = Record<string, any>;
const text = (value: unknown) => String(value ?? "").trim();
const compact = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const knownKeys = ["gto", "ets2", "ats", "toe3", "wtds", "wbds", "pbs"];

export function newsSimulatorKey(value: unknown): string {
  const aliases = [...collectSimulatorAliases(text(value))].map(compact);
  return knownKeys.find(key => aliases.includes(key)) || compact(value);
}

export function newsSimulatorAliases(...values: unknown[]): string[] {
  const aliases = new Set<string>();
  for (const value of values) {
    const key = newsSimulatorKey(value);
    if (key) aliases.add(key);
    for (const alias of collectSimulatorAliases(text(value))) {
      const normalized = compact(alias);
      if (normalized) aliases.add(normalized);
    }
  }
  return [...aliases].slice(0, 10);
}

/** The selected workspace owns the default. A stale account/recruitment
 * simulator must never be combined with a different active company. */
export function resolveNewsSessionSimulator({ activeCompanyId, currentUser, companies = [], allCompanies = [], simulators = [], catalogSettled = false }: {
  activeCompanyId?: string | null;
  currentUser?: RecordLike | null;
  companies?: RecordLike[];
  allCompanies?: RecordLike[];
  simulators?: RecordLike[];
  catalogSettled?: boolean;
}) {
  const byId = new Map<string, RecordLike>();
  // Membership/workspace snapshots take precedence over the broad catalog.
  for (const company of [...allCompanies, ...companies]) if (text(company.id)) byId.set(text(company.id), company);
  const companyId = text(activeCompanyId) || text(currentUser?.companyId);
  const company = byId.get(companyId);
  if (companyId && !company) return { companyId, key: "", label: "", aliases: [] as string[], pending: !catalogSettled };

  const source = company || currentUser;
  if (!source) return { companyId, key: "", label: "", aliases: [] as string[], pending: false };
  const rawId = text(source.simulatorId || source.simuladorId || (company ? "" : source.currentRecruitmentSimulatorId));
  const sourceName = text(source.simulatorName || source.simuladorNome || source.simulator || source.simulador);
  // Company/user names are not simulator identities. Only explicit simulator
  // fields may participate in catalog matching or become the filter label.
  const identity = { simulatorId: rawId, simulatorName: sourceName };
  const companyIdentities = [...byId.values()].map(item => ({
    simulatorId: item.simulatorId || item.simuladorId,
    simulatorName: item.simulatorName || item.simuladorNome || item.simulator || item.simulador,
  }));
  const label = resolveSimulatorDisplayLabel(identity, simulators, companyIdentities);
  if (!label && !sourceName && isOpaqueSimulatorCode(rawId)) return { companyId, key: "", label: "", aliases: [] as string[], pending: !catalogSettled && simulators.length === 0 };
  const key = newsSimulatorKey(label || sourceName || rawId);
  const aliases = newsSimulatorAliases(key, rawId, label, sourceName);
  return { companyId, key, label: label || sourceName || rawId, aliases, pending: false };
}
