import {
  collectSimulatorAliases,
  normalizeSimulatorId,
  resolveSimulatorId,
  resolveSimulatorName,
} from "./resolveSimulator";

export interface SimulatorSelectorOption {
  value: string;
  label: string;
  aliases: string[];
  canonicalId?: string;
}

type SimulatorLike = Record<string, unknown>;

type AliasGroup = {
  aliases: Set<string>;
  catalogIds: string[];
  companyIds: string[];
  catalogLabels: string[];
  companyLabels: string[];
  active: boolean;
};

const readText = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

export const normalizeSimulatorAlias = (value: unknown): string =>
  normalizeSimulatorId(String(value || ""));

export const isOpaqueSimulatorCode = (value: unknown): boolean => {
  const text = String(value || "").trim();
  if (!text) return false;

  // Firestore auto IDs and user/document identifiers are intentionally not
  // suitable as labels. They can remain internal values, but never appear in
  // the simulator selector.
  return (
    /^[A-Za-z0-9_-]{18,}$/.test(text) &&
    /[A-Z]/.test(text) &&
    /[a-z]/.test(text) &&
    /\d/.test(text)
  );
};

const knownSimulatorLabel = (normalized: string): string | null => {
  const compact = normalized.replace(/-/g, "");
  const labels: Record<string, string> = {
    gto: "GTO",
    globaltruckonline: "GTO",
    globaltruck: "GTO",
    wtds: "WTDS",
    wbds: "WBDS",
    toe3: "TOE 3",
    ets2: "ETS 2",
    eurotrucksimulator2: "ETS 2",
    ats: "ATS",
    americantrucksimulator: "ATS",
    pbs: "PBS",
  };
  return labels[compact] || null;
};

export const formatSimulatorLabel = (value: unknown): string => {
  const text = String(value || "").trim();
  if (!text || isOpaqueSimulatorCode(text)) return "";

  const normalized = normalizeSimulatorAlias(text);
  const known = knownSimulatorLabel(normalized);
  if (known) return known;

  return text
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (part.length <= 4) return part.toUpperCase();
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
};

const collectAliases = (
  source: SimulatorLike | null | undefined,
  includeDocumentId = false,
): Set<string> => collectSimulatorAliases(source, includeDocumentId);

const intersects = (left: Set<string>, right: Set<string>): boolean => {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
};

const mergeGroups = (target: AliasGroup, source: AliasGroup) => {
  source.aliases.forEach((alias) => target.aliases.add(alias));
  target.catalogIds.push(...source.catalogIds);
  target.companyIds.push(...source.companyIds);
  target.catalogLabels.push(...source.catalogLabels);
  target.companyLabels.push(...source.companyLabels);
  target.active = target.active || source.active;
};

const mostFrequent = (values: string[]): string => {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  })[0]?.[0] || "";
};

const pickLabel = (group: AliasGroup): string => {
  const candidates = [...group.catalogLabels, ...group.companyLabels]
    .map(formatSimulatorLabel)
    .filter(Boolean);

  const known = candidates.find((candidate) =>
    Boolean(knownSimulatorLabel(normalizeSimulatorAlias(candidate))),
  );
  if (known) return known;

  return candidates.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b, "pt-BR");
  })[0] || "";
};

const pickValue = (group: AliasGroup, label: string): string => {
  // Selector values are canonical identifiers. Human-readable names remain
  // labels/aliases and never become competitive keys.
  const catalogId = group.catalogIds.find(Boolean);
  if (catalogId) return catalogId;

  const opaqueCompanyId = group.companyIds.find(isOpaqueSimulatorCode);
  if (opaqueCompanyId) return opaqueCompanyId;

  const companyId = mostFrequent(group.companyIds);
  if (companyId) return companyId;

  return normalizeSimulatorAlias(label);
};

/**
 * Builds a clean simulator selector from the canonical catalog plus legacy
 * company aliases. Raw Firestore IDs remain usable internally, but are never
 * rendered as labels. Equivalent ID/name records are merged into one option.
 */
export function buildSimulatorSelectorOptions(
  simulators: SimulatorLike[] = [],
  companies: SimulatorLike[] = [],
): SimulatorSelectorOption[] {
  const records: AliasGroup[] = [];

  (Array.isArray(simulators) ? simulators : []).forEach((simulator) => {
    const aliases = collectAliases(simulator, true);
    if (aliases.size === 0) return;
    records.push({
      aliases,
      catalogIds: [readText(simulator.id)],
      companyIds: [],
      catalogLabels: [
        readText(
          simulator.name,
          simulator.simulatorName,
          simulator.nome,
          simulator.label,
          simulator.title,
          simulator.displayName,
        ),
      ],
      companyLabels: [],
      active: simulator.active !== false,
    });
  });

  (Array.isArray(companies) ? companies : []).forEach((company) => {
    const aliases = collectAliases(company);
    if (aliases.size === 0) return;
    records.push({
      aliases,
      catalogIds: [],
      companyIds: [readText(company.simulatorId, company.simuladorId)],
      catalogLabels: [],
      companyLabels: [
        readText(
          company.simulatorName,
          company.simuladorNome,
          company.simulator,
        ),
      ],
      active: true,
    });
  });

  const groups: AliasGroup[] = [];
  records.forEach((record) => {
    const matchingIndexes = groups
      .map((group, index) => (intersects(group.aliases, record.aliases) ? index : -1))
      .filter((index) => index >= 0);

    if (matchingIndexes.length === 0) {
      groups.push(record);
      return;
    }

    const targetIndex = matchingIndexes[0];
    mergeGroups(groups[targetIndex], record);
    matchingIndexes
      .slice(1)
      .sort((a, b) => b - a)
      .forEach((index) => {
        mergeGroups(groups[targetIndex], groups[index]);
        groups.splice(index, 1);
      });
  });

  const optionsByLabel = new Map<string, SimulatorSelectorOption>();
  groups.forEach((group) => {
    // Inactive catalog entries remain available when a company still uses
    // them, preserving historical and current ranking access.
    const hasCompanyUsage = group.companyIds.some(Boolean) || group.companyLabels.some(Boolean);
    if (!group.active && !hasCompanyUsage) return;

    const label = pickLabel(group);
    // An opaque document ID without any semantic name cannot be presented as
    // a trustworthy simulator option. Hide it instead of exposing the raw ID
    // or inventing a generic duplicate entry.
    if (!label) return;

    const labelKey = normalizeSimulatorAlias(label);
    const value = pickValue(group, label);
    const option: SimulatorSelectorOption = {
      value,
      label,
      aliases: Array.from(group.aliases),
      canonicalId: value || undefined,
    };

    const existing = optionsByLabel.get(labelKey);
    if (!existing) {
      optionsByLabel.set(labelKey, option);
      return;
    }

    const aliases = new Set([...existing.aliases, ...option.aliases]);
    optionsByLabel.set(labelKey, {
      ...existing,
      aliases: Array.from(aliases),
      canonicalId: existing.canonicalId || option.canonicalId,
    });
  });

  return Array.from(optionsByLabel.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "pt-BR", { numeric: true }),
  );
}

export function findSimulatorOption(
  selectedValue: unknown,
  options: SimulatorSelectorOption[],
): SimulatorSelectorOption | undefined {
  const normalized = normalizeSimulatorAlias(selectedValue);
  if (!normalized) return undefined;

  return options.find(
    (option) =>
      normalizeSimulatorAlias(option.value) === normalized ||
      option.aliases.includes(normalized),
  );
}

export function companyMatchesSimulatorOption(
  company: SimulatorLike,
  selectedValue: unknown,
  options: SimulatorSelectorOption[],
): boolean {
  const option = findSimulatorOption(selectedValue, options);
  if (!option) return false;
  const companyAliases = collectAliases(company);
  return option.aliases.some((alias) => companyAliases.has(alias));
}


export function resolveSimulatorDisplayLabel(
  source: SimulatorLike | null | undefined,
  simulators: SimulatorLike[] = [],
  companies: SimulatorLike[] = [],
): string {
  if (!source) return "";

  const sourceAliases = collectAliases(source);
  const catalogMatch = (Array.isArray(simulators) ? simulators : []).find(
    (simulator) => intersects(sourceAliases, collectAliases(simulator, true)),
  );

  if (catalogMatch) {
    const canonicalLabel = readText(
      catalogMatch.name,
      catalogMatch.simulatorName,
      catalogMatch.nome,
      catalogMatch.label,
      catalogMatch.title,
      catalogMatch.displayName,
    );
    if (canonicalLabel) return canonicalLabel;
  }

  return formatSimulatorLabel(
    resolveSimulatorName(source, simulators, companies),
  );
}

export function resolveCompanySimulatorFilterValue(
  company: SimulatorLike | null | undefined,
  simulators: SimulatorLike[] = [],
  companies: SimulatorLike[] = [],
): string {
  if (!company) return "";
  return resolveSimulatorId(company, simulators, companies);
}

/**
 * Resolves only against the canonical simulator catalog. Legacy aliases and
 * arbitrary company text are intentionally not accepted here because this
 * function feeds the pre-navigation profile context.
 */
export function resolveRegisteredSimulatorId(
  source: SimulatorLike | null | undefined,
  simulators: SimulatorLike[] = [],
): string {
  if (!source || !Array.isArray(simulators)) return "";
  const sourceAliases = collectAliases(source);
  if (sourceAliases.size === 0) return "";

  const match = simulators.find((simulator) =>
    intersects(sourceAliases, collectAliases(simulator, true)),
  );
  return match ? readText(match.id) : "";
}
