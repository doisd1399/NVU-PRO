export type SimulatorLike = Record<string, unknown>;

type SimulatorIdentityGroup = {
  aliases: Set<string>;
  catalogIds: string[];
  companyIds: string[];
  labels: string[];
};

const readText = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

export function normalizeSimulatorId(value: unknown = ""): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const UNSUPPORTED_SIMULATOR_ALIASES = new Set([
  "grand-truck-simulator",
]);

export function isUnsupportedSimulatorAlias(value: unknown): boolean {
  return UNSUPPORTED_SIMULATOR_ALIASES.has(normalizeSimulatorId(value));
}

const simulatorSemanticValues = (record: SimulatorLike): unknown[] => [
  record.simulatorName,
  record.simuladorNome,
  record.simulator,
  record.name,
  record.nome,
  record.label,
  record.title,
  record.displayName,
];

const hasUnsupportedSimulatorSemantic = (record: SimulatorLike): boolean =>
  simulatorSemanticValues(record).some(isUnsupportedSimulatorAlias);

const KNOWN_SIMULATOR_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["gto", "global-truck-online", "global-truck"],
  ["wtds", "world-truck-driving-simulator"],
  ["wbds", "world-bus-driving-simulator"],
  ["toe-3", "toe3", "truckers-of-europe-3"],
  ["ets-2", "ets2", "euro-truck-simulator-2"],
  ["ats", "american-truck-simulator"],
  ["pbs", "proton-bus-simulator"],
];

const expandKnownAliases = (aliases: Set<string>): Set<string> => {
  const expanded = new Set(aliases);
  KNOWN_SIMULATOR_ALIAS_GROUPS.forEach((group) => {
    if (group.some((alias) => expanded.has(alias))) {
      group.forEach((alias) => expanded.add(alias));
    }
  });
  return expanded;
};

export function isAllSimulatorSelection(value: unknown): boolean {
  let candidate = value;
  if (value && typeof value === "object") {
    const record = value as SimulatorLike;
    candidate =
      record.simulatorId ||
      record.simuladorId ||
      record.simulatorName ||
      record.simuladorNome ||
      record.simulator;
  }
  const normalized = normalizeSimulatorId(candidate);
  return normalized === "all" || normalized === "todos-os-simuladores";
}

export function collectSimulatorAliases(
  source: unknown,
  includeDocumentId = false,
): Set<string> {
  const aliases = new Set<string>();

  if (typeof source === "string") {
    const normalized = normalizeSimulatorId(source);
    if (normalized && !isUnsupportedSimulatorAlias(normalized)) {
      aliases.add(normalized);
    }
    return expandKnownAliases(aliases);
  }

  if (!source || typeof source !== "object") return aliases;
  const record = source as SimulatorLike;
  const semanticValues = simulatorSemanticValues(record);
  if (hasUnsupportedSimulatorSemantic(record)) return aliases;

  [
    includeDocumentId ? record.id : undefined,
    record.simulatorId,
    record.simuladorId,
    ...semanticValues,
  ].forEach((value) => {
    const normalized = normalizeSimulatorId(value);
    if (normalized && !isUnsupportedSimulatorAlias(normalized)) {
      aliases.add(normalized);
    }
  });

  return expandKnownAliases(aliases);
}

export function isTrailerlessSimulator(
  value: unknown,
  simulators: unknown[] = [],
): boolean {
  const aliases = collectSimulatorAliases(value, true);
  if (aliases.has("wbds") || aliases.has("pbs")) return true;

  const catalog = Array.isArray(simulators) ? simulators : [];
  const matchedSimulator = catalog.find((simulator) => {
    const simulatorAliases = collectSimulatorAliases(simulator, true);
    return intersects(aliases, simulatorAliases);
  });
  if (!matchedSimulator) return false;

  const matchedAliases = collectSimulatorAliases(matchedSimulator, true);
  return matchedAliases.has("wbds") || matchedAliases.has("pbs");
}

export const simulatorSupportsTrailers = (
  value: unknown,
  simulators: unknown[] = [],
): boolean => !isTrailerlessSimulator(value, simulators);

export function hasSimulatorIdentity(data: unknown): boolean {
  if (typeof data === "string") return collectSimulatorAliases(data).size > 0;
  if (!data || typeof data !== "object") return false;
  return collectSimulatorAliases(data).size > 0;
}

const intersects = (left: Set<string>, right: Set<string>): boolean => {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
};

const mergeGroup = (
  target: SimulatorIdentityGroup,
  source: SimulatorIdentityGroup,
) => {
  source.aliases.forEach((alias) => target.aliases.add(alias));
  target.catalogIds.push(...source.catalogIds);
  target.companyIds.push(...source.companyIds);
  target.labels.push(...source.labels);
};

const mostFrequent = (values: string[]): string => {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return (
    Array.from(counts.entries()).sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })[0]?.[0] || ""
  );
};

const looksLikeFirestoreDocumentId = (value: string): boolean =>
  /^[A-Za-z0-9_-]{18,}$/.test(value) &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /\d/.test(value);

function buildIdentityGroups(
  simulators: SimulatorLike[] = [],
  companies: SimulatorLike[] = [],
): SimulatorIdentityGroup[] {
  const records: SimulatorIdentityGroup[] = [];

  simulators.forEach((simulator) => {
    const aliases = collectSimulatorAliases(simulator, true);
    if (aliases.size === 0) return;
    records.push({
      aliases,
      catalogIds: [readText(simulator.id)],
      companyIds: [],
      labels: [
        readText(
          simulator.name,
          simulator.simulatorName,
          simulator.nome,
          simulator.label,
          simulator.title,
          simulator.displayName,
        ),
      ],
    });
  });

  companies.forEach((company) => {
    const aliases = collectSimulatorAliases(company);
    if (aliases.size === 0) return;
    records.push({
      aliases,
      catalogIds: [],
      companyIds: [readText(company.simulatorId, company.simuladorId)],
      labels: [
        readText(
          company.simulatorName,
          company.simuladorNome,
          company.simulator,
        ),
      ],
    });
  });

  const groups: SimulatorIdentityGroup[] = [];
  records.forEach((record) => {
    const matchingIndexes = groups
      .map((group, index) => (intersects(group.aliases, record.aliases) ? index : -1))
      .filter((index) => index >= 0);

    if (matchingIndexes.length === 0) {
      groups.push(record);
      return;
    }

    const targetIndex = matchingIndexes[0];
    mergeGroup(groups[targetIndex], record);
    matchingIndexes
      .slice(1)
      .sort((left, right) => right - left)
      .forEach((index) => {
        mergeGroup(groups[targetIndex], groups[index]);
        groups.splice(index, 1);
      });
  });

  return groups;
}

// Simulator and company collections come from immutable React state snapshots.
// Rebuilding the same alias graph for every trip turned a linear filter into
// thousands of repeated full-catalog scans. Cache by both array identities so
// a new Firestore snapshot still receives a fresh graph automatically.
const identityGroupsCache = new WeakMap<
  SimulatorLike[],
  WeakMap<SimulatorLike[], SimulatorIdentityGroup[]>
>();

function getIdentityGroups(
  simulators: SimulatorLike[],
  companies: SimulatorLike[],
): SimulatorIdentityGroup[] {
  let byCompanyCollection = identityGroupsCache.get(simulators);
  if (!byCompanyCollection) {
    byCompanyCollection = new WeakMap();
    identityGroupsCache.set(simulators, byCompanyCollection);
  }

  const cached = byCompanyCollection.get(companies);
  if (cached) return cached;

  const groups = buildIdentityGroups(simulators, companies);
  byCompanyCollection.set(companies, groups);
  return groups;
}

function pickCanonicalId(group: SimulatorIdentityGroup): string {
  const catalogId = group.catalogIds.find(Boolean);
  if (catalogId) return catalogId;

  const opaqueCompanyId = group.companyIds.find((value) =>
    looksLikeFirestoreDocumentId(value),
  );
  if (opaqueCompanyId) return opaqueCompanyId;

  const companyId = mostFrequent(group.companyIds);
  if (companyId) return companyId;

  const semanticAlias = Array.from(group.aliases).sort((left, right) => {
    if (left.length !== right.length) return left.length - right.length;
    return left.localeCompare(right);
  })[0];
  return semanticAlias || "";
}

function findIdentityGroup(
  value: unknown,
  simulators: SimulatorLike[],
  companies: SimulatorLike[],
): SimulatorIdentityGroup | undefined {
  const aliases = collectSimulatorAliases(value);
  if (aliases.size === 0) return undefined;
  return getIdentityGroups(simulators, companies).find((group) =>
    intersects(group.aliases, aliases),
  );
}

/**
 * Resolves every current or legacy simulator representation to one canonical
 * identifier. Components and metric engines must use this result as their
 * comparison key; display names remain outside the competitive path.
 */
export function resolveSimulatorId(
  data: unknown,
  simulators: SimulatorLike[] = [],
  companies: SimulatorLike[] = [],
): string {
  if (!data) return "";
  if (isAllSimulatorSelection(data)) return "all";

  const group = findIdentityGroup(data, simulators, companies);
  if (group) return pickCanonicalId(group);

  if (typeof data === "string") {
    return isUnsupportedSimulatorAlias(data) ? "" : normalizeSimulatorId(data);
  }
  if (typeof data !== "object") return "";

  const record = data as SimulatorLike;
  if (hasUnsupportedSimulatorSemantic(record)) return "";
  const explicitId = readText(record.simulatorId, record.simuladorId);
  if (explicitId) {
    return isUnsupportedSimulatorAlias(explicitId) ? "" : explicitId;
  }

  const legacyName = readText(
    record.simulatorName,
    record.simuladorNome,
    record.simulator,
    record.name,
    record.nome,
    record.label,
  );
  return isUnsupportedSimulatorAlias(legacyName)
    ? ""
    : normalizeSimulatorId(legacyName);
}

export function resolveSimulatorName(
  data: unknown,
  simulators: SimulatorLike[] = [],
  companies: SimulatorLike[] = [],
): string {
  if (!data) return "";

  if (typeof data === "string" && isUnsupportedSimulatorAlias(data)) {
    return "";
  }
  if (
    data &&
    typeof data === "object" &&
    hasUnsupportedSimulatorSemantic(data as SimulatorLike)
  ) {
    return "";
  }

  const group = findIdentityGroup(data, simulators, companies);
  const groupLabel = group?.labels.find(Boolean);
  if (groupLabel) return groupLabel;

  if (typeof data === "string") return data;
  if (typeof data !== "object") return "";

  const record = data as SimulatorLike;
  const displayName = readText(
    record.simulatorName,
    record.simuladorNome,
    record.simulator,
    record.name,
    record.nome,
    record.label,
    record.title,
    record.displayName,
  );
  if (displayName) return displayName;

  const simulatorId = readText(record.simulatorId, record.simuladorId, record.id);
  return simulatorId;
}

export function resolveSimulator(
  data: unknown,
  simulators: SimulatorLike[] = [],
  companies: SimulatorLike[] = [],
): string {
  return resolveSimulatorId(data, simulators, companies);
}
