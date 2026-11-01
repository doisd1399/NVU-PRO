// src/hooks/useProfileRanking.ts
import { useMemo } from "react";

// profile-stub:aggregate
var useRankingAggregate = () => globalThis.__profile.aggregate;

// profile-stub:companies
var useRankingCompaniesByIds = () => globalThis.__profile.companies;

// profile-stub:users
var useRankingUsersRealtime = () => globalThis.__profile.users;

// profile-stub:trips
var useTripsRealtime = () => globalThis.__profile.trips;

// functions/src/driverDisplayIdentity.ts
var text = (value) => typeof value === "string" ? value.trim() : "";
var first = (...values) => values.map(text).find(Boolean) || "";
function driverDisplayIdentity(profile, application) {
  const user = profile || {};
  const applicationMatches = application && application.type !== "company_registration" && application.status === "approved" && application.isCurrent !== false && !application.accessRevokedAt && !application.accessRevokedReason && text(application.userId) === text(user.id || user.userId || user.uid) && (!user.approvedIdentityApplicationId || application.id === user.approvedIdentityApplicationId);
  const form = applicationMatches ? application : {};
  const currentName = user.profileNameSource === "user_edit" || user.approvedIdentityVersion === 2;
  const name = (currentName ? first(user.name, form.fullName, user.approvedIdentityName) : first(form.fullName, user.approvedIdentityName, user.fullName, user.registeredName, user.name)) || "Motorista";
  const editedPhoto = user.profilePhotoSource === "user_edit";
  const currentPhoto = editedPhoto || user.approvedIdentityVersion === 2;
  const photoCandidates = currentPhoto ? [
    user.profilePhotoURL,
    user.profilePhotoUrl,
    form.applicationPhotoURL,
    user.approvedIdentityPhotoURL,
    user.applicationPhotoURL,
    user.ownerPhotoUrl,
    user.ownerPhotoURL,
    user.avatar,
    user.profileImage,
    user.imageUrl,
    user.photo
  ] : [
    form.applicationPhotoURL,
    user.approvedIdentityPhotoURL,
    user.applicationPhotoURL,
    user.profilePhotoURL,
    user.profilePhotoUrl,
    user.ownerPhotoUrl,
    user.ownerPhotoURL,
    user.avatar,
    user.profileImage,
    user.imageUrl,
    user.photo,
    user.photoURL,
    user.photoUrl
  ];
  const profilePhotoURL = editedPhoto ? text(user.profilePhotoURL) : photoCandidates.map(text).find((value) => {
    if (!value || value === text(user.authPhotoURL) || value === text(user.googlePhotoURL)) return false;
    if (value.startsWith("data:image/") || value.startsWith("blob:")) return true;
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !/(^|\.)(googleusercontent\.com|ggpht\.com)$/i.test(url.hostname);
    } catch {
      return false;
    }
  }) || "";
  return { name, profilePhotoURL };
}

// src/lib/resolveSimulator.ts
var readText = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};
function normalizeSimulatorId(value = "") {
  return String(value || "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
var UNSUPPORTED_SIMULATOR_ALIASES = /* @__PURE__ */ new Set([
  "grand-truck-simulator"
]);
function isUnsupportedSimulatorAlias(value) {
  return UNSUPPORTED_SIMULATOR_ALIASES.has(normalizeSimulatorId(value));
}
var simulatorSemanticValues = (record) => [
  record.simulatorName,
  record.simuladorNome,
  record.simulator,
  record.name,
  record.nome,
  record.label,
  record.title,
  record.displayName
];
var hasUnsupportedSimulatorSemantic = (record) => simulatorSemanticValues(record).some(isUnsupportedSimulatorAlias);
var KNOWN_SIMULATOR_ALIAS_GROUPS = [
  ["gto", "global-truck-online", "global-truck"],
  ["wtds", "world-truck-driving-simulator"],
  ["wbds", "world-bus-driving-simulator"],
  ["toe-3", "toe3", "truckers-of-europe-3"],
  ["ets-2", "ets2", "euro-truck-simulator-2"],
  ["ats", "american-truck-simulator"],
  ["pbs", "proton-bus-simulator"]
];
var expandKnownAliases = (aliases) => {
  const expanded = new Set(aliases);
  KNOWN_SIMULATOR_ALIAS_GROUPS.forEach((group) => {
    if (group.some((alias) => expanded.has(alias))) {
      group.forEach((alias) => expanded.add(alias));
    }
  });
  return expanded;
};
function isAllSimulatorSelection(value) {
  let candidate = value;
  if (value && typeof value === "object") {
    const record = value;
    candidate = record.simulatorId || record.simuladorId || record.simulatorName || record.simuladorNome || record.simulator;
  }
  const normalized = normalizeSimulatorId(candidate);
  return normalized === "all" || normalized === "todos-os-simuladores";
}
function collectSimulatorAliases(source, includeDocumentId = false) {
  const aliases = /* @__PURE__ */ new Set();
  if (typeof source === "string") {
    const normalized = normalizeSimulatorId(source);
    if (normalized && !isUnsupportedSimulatorAlias(normalized)) {
      aliases.add(normalized);
    }
    return expandKnownAliases(aliases);
  }
  if (!source || typeof source !== "object") return aliases;
  const record = source;
  const semanticValues = simulatorSemanticValues(record);
  if (hasUnsupportedSimulatorSemantic(record)) return aliases;
  [
    includeDocumentId ? record.id : void 0,
    record.simulatorId,
    record.simuladorId,
    record.currentRecruitmentSimulatorId,
    ...semanticValues
  ].forEach((value) => {
    const normalized = normalizeSimulatorId(value);
    if (normalized && !isUnsupportedSimulatorAlias(normalized)) {
      aliases.add(normalized);
    }
  });
  return expandKnownAliases(aliases);
}
function hasSimulatorIdentity(data) {
  if (typeof data === "string") return collectSimulatorAliases(data).size > 0;
  if (!data || typeof data !== "object") return false;
  return collectSimulatorAliases(data).size > 0;
}
var intersects = (left, right) => {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
};
var mergeGroup = (target, source) => {
  source.aliases.forEach((alias) => target.aliases.add(alias));
  target.catalogIds.push(...source.catalogIds);
  target.companyIds.push(...source.companyIds);
  target.labels.push(...source.labels);
};
var mostFrequent = (values) => {
  const counts = /* @__PURE__ */ new Map();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  })[0]?.[0] || "";
};
var looksLikeFirestoreDocumentId = (value) => /^[A-Za-z0-9_-]{18,}$/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
function buildIdentityGroups(simulators = [], companies = []) {
  const records = [];
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
          simulator.displayName
        )
      ]
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
          company.simulator
        )
      ]
    });
  });
  const groups = [];
  records.forEach((record) => {
    const matchingIndexes = groups.map((group, index) => intersects(group.aliases, record.aliases) ? index : -1).filter((index) => index >= 0);
    if (matchingIndexes.length === 0) {
      groups.push(record);
      return;
    }
    const targetIndex = matchingIndexes[0];
    mergeGroup(groups[targetIndex], record);
    matchingIndexes.slice(1).sort((left, right) => right - left).forEach((index) => {
      mergeGroup(groups[targetIndex], groups[index]);
      groups.splice(index, 1);
    });
  });
  return groups;
}
var identityGroupsCache = /* @__PURE__ */ new WeakMap();
function getIdentityGroups(simulators, companies) {
  let byCompanyCollection = identityGroupsCache.get(simulators);
  if (!byCompanyCollection) {
    byCompanyCollection = /* @__PURE__ */ new WeakMap();
    identityGroupsCache.set(simulators, byCompanyCollection);
  }
  const cached = byCompanyCollection.get(companies);
  if (cached) return cached;
  const groups = buildIdentityGroups(simulators, companies);
  byCompanyCollection.set(companies, groups);
  return groups;
}
function pickCanonicalId(group) {
  const catalogId = group.catalogIds.find(Boolean);
  if (catalogId) return catalogId;
  const opaqueCompanyId = group.companyIds.find(
    (value) => looksLikeFirestoreDocumentId(value)
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
function findIdentityGroup(value, simulators, companies) {
  const aliases = collectSimulatorAliases(value);
  if (aliases.size === 0) return void 0;
  return getIdentityGroups(simulators, companies).find(
    (group) => intersects(group.aliases, aliases)
  );
}
function resolveSimulatorId(data, simulators = [], companies = []) {
  if (!data) return "";
  if (isAllSimulatorSelection(data)) return "all";
  const group = findIdentityGroup(data, simulators, companies);
  if (group) return pickCanonicalId(group);
  if (typeof data === "string") {
    return isUnsupportedSimulatorAlias(data) ? "" : normalizeSimulatorId(data);
  }
  if (typeof data !== "object") return "";
  const record = data;
  if (hasUnsupportedSimulatorSemantic(record)) return "";
  const explicitId = readText(record.simulatorId, record.simuladorId, record.currentRecruitmentSimulatorId);
  if (explicitId) {
    return isUnsupportedSimulatorAlias(explicitId) ? "" : explicitId;
  }
  const legacyName = readText(
    record.simulatorName,
    record.simuladorNome,
    record.simulator,
    record.name,
    record.nome,
    record.label
  );
  return isUnsupportedSimulatorAlias(legacyName) ? "" : normalizeSimulatorId(legacyName);
}

// src/lib/rankingPeriods.ts
var RANKING_TIME_ZONE = "America/Sao_Paulo";
var DAY_MS = 24 * 60 * 60 * 1e3;
var RANKING_UTC_OFFSET_MS = 3 * 60 * 60 * 1e3;
function pad(value) {
  return String(value).padStart(2, "0");
}
var calendarPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var monthLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long"
});
function readCalendarPart(parts, type) {
  return Number(parts.find((part) => part.type === type)?.value || 0);
}
function getRankingCalendarDateParts(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (isoMatch) {
      return {
        year: Number(isoMatch[1]),
        month: Number(isoMatch[2]),
        day: Number(isoMatch[3])
      };
    }
    const brazilianMatch = /^(\d{2})\/(\d{2})\/(\d{2,4})/.exec(trimmed);
    if (brazilianMatch) {
      const rawYear = Number(brazilianMatch[3]);
      return {
        year: rawYear < 100 ? 2e3 + rawYear : rawYear,
        month: Number(brazilianMatch[2]),
        day: Number(brazilianMatch[1])
      };
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { year: 1970, month: 1, day: 1 };
  }
  const parts = calendarPartsFormatter.formatToParts(parsed);
  return {
    year: readCalendarPart(parts, "year"),
    month: readCalendarPart(parts, "month"),
    day: readCalendarPart(parts, "day")
  };
}
function calendarDateToRankingInstant(parts) {
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) + RANKING_UTC_OFFSET_MS
  );
}
function calendarDateToCivilUtc(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}
function civilUtcToCalendarParts(value) {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate()
  };
}
function getRankingUtcWeeklyRange(referenceDate = /* @__PURE__ */ new Date()) {
  const current = calendarDateToCivilUtc(getRankingCalendarDateParts(referenceDate));
  current.setUTCDate(current.getUTCDate() - current.getUTCDay());
  const start = calendarDateToRankingInstant(civilUtcToCalendarParts(current));
  return {
    start,
    end: new Date(start.getTime() + 7 * DAY_MS - 1)
  };
}
function buildRankingUtcPeriodKey(periodType, referenceDate = /* @__PURE__ */ new Date()) {
  const current = getRankingCalendarDateParts(referenceDate);
  if (periodType === "mes") {
    return `mes_${current.year}-${pad(current.month)}`;
  }
  const start = getRankingUtcWeeklyRange(referenceDate).start;
  const startCalendar = getRankingCalendarDateParts(start);
  return `semana_${startCalendar.year}-${pad(startCalendar.month)}-${pad(startCalendar.day)}`;
}

// functions/src/simulatorCurrencyRegistry.ts
var SIMULATOR_CURRENCY_REGISTRY = [
  { simulator: "GTO", currency: "BRL", aliases: ["GTO", "GLOBAL TRUCK", "GLOBAL TRUCK ONLINE", "COM.STARGAMESAPPS.GTO"] },
  { simulator: "WTDS", currency: "BRL", aliases: ["WTDS", "WORLD TRUCK DRIVING SIMULATOR"] },
  { simulator: "WBDS", currency: "BRL", aliases: ["WBDS", "WORLD BUS DRIVING SIMULATOR"] },
  { simulator: "TOE3", currency: "EUR", aliases: ["TOE3", "TOE 3", "TRUCKERS OF EUROPE 3"] }
];
var simulatorFields = [
  "simulatorId",
  "simulatorCode",
  "simulatorKey",
  "simulatorName",
  "simulator",
  "simuladorId",
  "simuladorCodigo",
  "simuladorKey",
  "simuladorNome",
  "simulador",
  "gameId",
  "gameCode",
  "gameName",
  "packageId"
];
function normalizeSimulatorAlias(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}
var aliasIndex = /* @__PURE__ */ new Map();
for (const entry of SIMULATOR_CURRENCY_REGISTRY) {
  for (const alias of entry.aliases) aliasIndex.set(normalizeSimulatorAlias(alias), entry);
}
function resolveSimulatorCurrency(trip) {
  const observed = simulatorFields.flatMap((field) => {
    const raw = String(trip[field] ?? "").trim();
    return raw ? [{ field, entry: aliasIndex.get(normalizeSimulatorAlias(raw)) }] : [];
  });
  const recognized = [...new Map(observed.filter((item) => item.entry).map((item) => [item.entry.simulator, item.entry])).values()];
  const observedSimulatorFields = observed.map((item) => item.field);
  if (recognized.length > 1) {
    return { status: "conflict", currencySource: "SIMULATOR_METADATA_CONFLICT", observedSimulatorFields };
  }
  if (recognized.length === 1) {
    return {
      simulator: recognized[0].simulator,
      currency: recognized[0].currency,
      status: "known",
      currencySource: "SIMULATOR_REGISTRY",
      observedSimulatorFields
    };
  }
  return { status: "unknown", currencySource: "SIMULATOR_UNRECOGNIZED", observedSimulatorFields };
}
function normalizeExplicitCurrency(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return { recognized: false, supported: false, ambiguous: false };
  if (raw === "R$" || raw === "R$ BRL") return { currency: "BRL", recognized: true, supported: true, ambiguous: false };
  if (raw === "\u20AC") return { currency: "EUR", recognized: true, supported: true, ambiguous: false };
  if (raw === "US$") return { currency: "USD", recognized: true, supported: true, ambiguous: false };
  if (raw === "$") return { recognized: false, supported: false, ambiguous: true };
  const isoLike = /^[A-Z]{3}$/.test(raw);
  const supported = /* @__PURE__ */ new Set(["BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG"]);
  const recognizedCodes = /* @__PURE__ */ new Set(["BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG", "CAD", "AUD", "NZD", "JPY", "CNY", "CHF", "INR"]);
  if (isoLike && recognizedCodes.has(raw)) return { currency: raw, recognized: true, supported: supported.has(raw), ambiguous: false };
  return { recognized: false, supported: false, ambiguous: false };
}

// src/lib/rankingAggregates.ts
var RANKING_AGGREGATE_RECONCILE_AFTER_MS = 60 * 60 * 1e3;
function buildRankingAggregatePeriodKey(periodType, referenceDate = /* @__PURE__ */ new Date()) {
  return buildRankingUtcPeriodKey(periodType, referenceDate);
}
function readEntityText(record, key) {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}
function isRankingEligibleCompany(company) {
  if (!company) return false;
  const status = String(
    company.status || company.situacao || company.state || "active"
  ).trim().toLocaleLowerCase("pt-BR");
  const deleted = company.deleted === true || company.softDeleted === true || company.excluida === true || company.excluido === true || [
    "deleted",
    "excluida",
    "excluido",
    "removed",
    "removida",
    "removido"
  ].includes(status);
  return !deleted && ["active", "approved", "ativo"].includes(status) && hasSimulatorIdentity(company);
}
function mergeRankingCompanyCatalogs(knownCompanies, confirmedCompanies, confirmedIds = []) {
  const authoritativeIds = new Set(confirmedIds);
  const byId = /* @__PURE__ */ new Map();
  knownCompanies.forEach((company) => {
    const id = String(company.id || "").trim();
    if (id && !authoritativeIds.has(id)) byId.set(id, company);
  });
  confirmedCompanies.forEach((company) => {
    const id = String(company.id || "").trim();
    if (id) byId.set(id, company);
  });
  return Array.from(byId.values()).filter(isRankingEligibleCompany);
}
function stableRankingSort(left, right) {
  if (right.val !== left.val) return right.val - left.val;
  if (right.trips !== left.trips) return right.trips - left.trips;
  const nameOrder = String(left.name || "").localeCompare(
    String(right.name || ""),
    "pt-BR",
    { sensitivity: "base", numeric: true }
  );
  return nameOrder || left.id.localeCompare(right.id);
}
function finalizeCurrencyRanking(items) {
  const currencies = new Set(items.flatMap((item) => [
    ...Object.keys(item.currencyTotals || {}),
    ...Object.keys(item.currencyTripCounts || {})
  ]));
  const unresolved = items.reduce((sum, item) => sum + (item.currencyUnresolvedTrips || 0), 0);
  const missing = items.reduce((sum, item) => sum + (item.currencyMissingValueTrips || 0), 0);
  const comparableCurrency = currencies.size === 1 && unresolved === 0 && missing === 0 ? [...currencies][0] : void 0;
  const ranked = items.map((item) => ({
    ...item,
    val: comparableCurrency ? item.currencyTotals?.[comparableCurrency] || 0 : 0,
    currency: comparableCurrency,
    currencyBreakdown: [.../* @__PURE__ */ new Set([
      ...Object.keys(item.currencyTotals || {}),
      ...Object.keys(item.currencyTripCounts || {})
    ])].map((currency) => ({
      currency,
      value: item.currencyTotals?.[currency] || 0,
      tripCount: item.currencyTripCounts?.[currency] || 0,
      missingValueTrips: item.currencyMissingValueTrips || 0
    }))
  }));
  return ranked.sort(stableRankingSort);
}
function shortDriverName(value) {
  const parts = String(value || "Motorista Desconhecido").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Motorista Desconhecido";
}
function resolveAggregateSimulatorCurrency(simulatorId, simulators) {
  const catalog = simulators.find((item) => readEntityText(item, "id") === simulatorId);
  const readFirst = (...keys) => keys.map((key) => readEntityText(catalog, key)).find(Boolean) || "";
  return resolveSimulatorCurrency({
    simulatorId,
    simulatorCode: readFirst("simulatorCode", "simuladorCodigo", "code", "slug", "key"),
    simulatorName: readFirst("simulatorName", "simuladorNome", "name", "nome", "label", "title", "displayName")
  });
}
function applyLegacyAggregateCurrency(stats, schemaVersion, simulatorResolution) {
  if (schemaVersion !== 4) return stats;
  const currencyTotals = { ...stats.currencyTotals || {} };
  const currencyTripCounts = { ...stats.currencyTripCounts || {} };
  const currencySourceCounts = { ...stats.currencySourceCounts || {} };
  let currencyUnresolvedTrips = Math.max(0, Math.trunc(stats.currencyUnresolvedTrips || 0));
  const partitionKeys = /* @__PURE__ */ new Set([...Object.keys(currencyTotals), ...Object.keys(currencyTripCounts)]);
  if (simulatorResolution.status === "conflict") {
    Object.keys(currencyTotals).forEach((key) => delete currencyTotals[key]);
    Object.keys(currencyTripCounts).forEach((key) => delete currencyTripCounts[key]);
    currencyUnresolvedTrips = Math.max(currencyUnresolvedTrips, stats.trips);
    currencySourceCounts.SIMULATOR_METADATA_CONFLICT = Math.max(
      currencySourceCounts.SIMULATOR_METADATA_CONFLICT || 0,
      stats.trips
    );
  } else if (simulatorResolution.currency) {
    const conflictsWithRegistry = [...partitionKeys].some((currency) => currency !== simulatorResolution.currency);
    if (conflictsWithRegistry) {
      Object.keys(currencyTotals).forEach((key) => delete currencyTotals[key]);
      Object.keys(currencyTripCounts).forEach((key) => delete currencyTripCounts[key]);
      currencyUnresolvedTrips = Math.max(currencyUnresolvedTrips, stats.trips);
      currencySourceCounts.CONFLICT = Math.max(currencySourceCounts.CONFLICT || 0, stats.trips);
    } else if (partitionKeys.size === 0 && currencyUnresolvedTrips === 0) {
      currencyTotals[simulatorResolution.currency] = stats.val;
      currencyTripCounts[simulatorResolution.currency] = stats.trips;
      currencySourceCounts.SIMULATOR_REGISTRY = Math.max(
        currencySourceCounts.SIMULATOR_REGISTRY || 0,
        stats.trips
      );
    }
  }
  return {
    ...stats,
    currencyTotals,
    currencyTripCounts,
    currencySourceCounts,
    currencyUnresolvedTrips
  };
}
function buildCompanyRankingFromAggregate(aggregate, companies, simulators = []) {
  const simulatorCurrency = resolveAggregateSimulatorCurrency(aggregate.simulatorId, simulators);
  const companiesById = new Map(
    companies.map((company) => [readEntityText(company, "id"), company]).filter(([id]) => Boolean(id))
  );
  const rows = Object.entries(aggregate.companies).map(([id, rawStats]) => {
    const stats = applyLegacyAggregateCurrency(rawStats, aggregate.schemaVersion, simulatorCurrency);
    const company = companiesById.get(id);
    if (!company || !isRankingEligibleCompany(company)) return null;
    if (company && resolveSimulatorId(company, simulators, companies) !== aggregate.simulatorId)
      return null;
    return {
      id,
      name: readEntityText(company, "companyName") || readEntityText(company, "name") || stats.name || "Empresa",
      logo: readEntityText(company, "logoUrl") || readEntityText(company, "logoURL") || readEntityText(company, "companyLogoURL") || readEntityText(company, "logo"),
      trips: stats.trips,
      val: stats.val,
      currencyTotals: stats.currencyTotals,
      currencyTripCounts: stats.currencyTripCounts,
      currencySourceCounts: stats.currencySourceCounts,
      currencyMissingValueTrips: stats.currencyMissingValueTrips,
      currencyUnresolvedTrips: stats.currencyUnresolvedTrips,
      pendingCatalog: false
    };
  }).filter((item) => Boolean(item)).sort(stableRankingSort);
  return finalizeCurrencyRanking(rows);
}
function buildDriverRankingFromAggregate(aggregate, users, companies, simulators = [], companyMembers = []) {
  const simulatorCurrency = resolveAggregateSimulatorCurrency(aggregate.simulatorId, simulators);
  const usersById = new Map(
    users.map((user) => [readEntityText(user, "id"), user]).filter(([id]) => Boolean(id))
  );
  const companiesById = new Map(
    companies.map((company) => [readEntityText(company, "id"), company]).filter(([id]) => Boolean(id))
  );
  const activeMembershipByUser = /* @__PURE__ */ new Map();
  companyMembers.forEach((membership) => {
    const userId = readEntityText(membership, "userId");
    const companyId = readEntityText(membership, "companyId");
    const status = readEntityText(membership, "status").toLowerCase();
    const roles = Array.isArray(membership.roles) ? membership.roles.map((role) => String(role).toLowerCase()) : [];
    const isDriver = roles.includes("driver") || readEntityText(membership, "role").toLowerCase() === "driver";
    const company = companiesById.get(companyId);
    if (!userId || !companyId || status !== "active" || !isDriver || !isRankingEligibleCompany(company) || resolveSimulatorId(company, simulators, companies) !== aggregate.simulatorId) {
      return;
    }
    const joinedAtValue = membership.joinedAt;
    const joinedAt = joinedAtValue instanceof Date ? joinedAtValue.getTime() : typeof joinedAtValue?.toDate === "function" ? joinedAtValue.toDate().getTime() : new Date(joinedAtValue).getTime() || 0;
    const current = activeMembershipByUser.get(userId);
    if (!current || joinedAt >= current.joinedAt) {
      activeMembershipByUser.set(userId, { companyId, joinedAt });
    }
  });
  const rows = Object.entries(aggregate.drivers).map(([id, rawStats]) => {
    const stats = applyLegacyAggregateCurrency(rawStats, aggregate.schemaVersion, simulatorCurrency);
    const user = usersById.get(id);
    const membershipCompanyId = activeMembershipByUser.get(id)?.companyId || "";
    const profileCompanyId = readEntityText(user, "companyId") || readEntityText(user, "activeCompanyId");
    const profileCompany = profileCompanyId ? companiesById.get(profileCompanyId) : void 0;
    const profileCompanyMatchesAggregate = Boolean(
      isRankingEligibleCompany(profileCompany) && resolveSimulatorId(profileCompany, simulators, companies) === aggregate.simulatorId
    );
    const candidateCompanyId = membershipCompanyId || (profileCompanyMatchesAggregate ? profileCompanyId : "") || stats.companyId || "";
    const company = candidateCompanyId ? companiesById.get(candidateCompanyId) : void 0;
    if (!company || !isRankingEligibleCompany(company)) return null;
    if (resolveSimulatorId(company, simulators, companies) !== aggregate.simulatorId)
      return null;
    return {
      id,
      name: shortDriverName(user ? driverDisplayIdentity(user).name : stats.name),
      logo: driverDisplayIdentity(user).profilePhotoURL,
      trips: stats.trips,
      val: stats.val,
      currencyTotals: stats.currencyTotals,
      currencyTripCounts: stats.currencyTripCounts,
      currencySourceCounts: stats.currencySourceCounts,
      currencyMissingValueTrips: stats.currencyMissingValueTrips,
      currencyUnresolvedTrips: stats.currencyUnresolvedTrips,
      companyId: candidateCompanyId,
      companyName: readEntityText(company, "companyName") || readEntityText(company, "name")
    };
  }).filter((item) => item !== null).sort(stableRankingSort);
  return finalizeCurrencyRanking(rows);
}

// src/lib/historyReadEvidence.ts
function hasHistoricalReadEvidence(trip) {
  const receipt = trip.historyReadEvidence;
  return receipt?.version === 1 && receipt.collection === "historico_viagens" && Boolean(receipt.physicalDocumentId) && receipt.physicalDocumentId === String(trip.physicalDocumentId || "").trim() && (receipt.transport === "server" || receipt.transport === "cache");
}

// src/lib/tripMetricPolicy.ts
var normalizeStatus = (value) => String(value || "").trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function parseLocalDate(candidate) {
  if (!candidate) return null;
  const parsed = candidate instanceof Date ? candidate : new Date(candidate);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > 0 ? parsed : null;
}
function parseSelectedDate(rawDate) {
  if (!rawDate) return null;
  if (rawDate instanceof Date) return rawDate.getTime() > 0 ? rawDate : null;
  if (typeof rawDate?.toDate === "function") {
    const parsed2 = rawDate.toDate();
    return parsed2 instanceof Date && parsed2.getTime() > 0 ? parsed2 : null;
  }
  if (rawDate?.seconds) {
    const parsed2 = new Date(Number(rawDate.seconds) * 1e3);
    return parsed2.getTime() > 0 ? parsed2 : null;
  }
  const parsed = new Date(rawDate);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > 0 ? parsed : null;
}
function getTripMetricDateResult(trip) {
  const localDateCandidates = [
    ["createdAtLocal", trip?.createdAtLocal],
    ["localCreatedAt", trip?.localCreatedAt],
    ["offlineCreatedAt", trip?.offlineCreatedAt],
    ["completedAtLocal", trip?.completedAtLocal]
  ];
  for (const [source2, candidate] of localDateCandidates) {
    const parsed2 = parseLocalDate(candidate);
    if (parsed2) return { date: parsed2, source: source2, valid: true };
  }
  const completedAtDate = trip?.completedAt?.toDate?.();
  const fallbackCandidates = [
    ["completedAt", completedAtDate || trip?.completedAt],
    ["serverValidatedAt", trip?.serverValidatedAt],
    ["dataFechamento", trip?.dataFechamento],
    ["date", trip?.date],
    ["dataLancamento", trip?.dataLancamento],
    ["createdAt", trip?.createdAt]
  ];
  const selected = fallbackCandidates.find(([, value]) => Boolean(value));
  if (!selected) return { date: /* @__PURE__ */ new Date(0), source: null, valid: false };
  const [source, rawDate] = selected;
  const parsed = parseSelectedDate(rawDate);
  return parsed ? { date: parsed, source, valid: true } : { date: /* @__PURE__ */ new Date(0), source, valid: false };
}
function getTripMetricDate(trip) {
  return getTripMetricDateResult(trip).date;
}
function getTripMetricAssessment(trip) {
  const lifecycleStatus = normalizeStatus(trip?.status);
  const historicalAdapterLifecycle = trip?.historicalReadOnly === true && (lifecycleStatus === "registered_local" || lifecycleStatus === "history_confirmed");
  const status = normalizeStatus(
    trip?.recordStatus || (historicalAdapterLifecycle ? "" : trip?.status)
  );
  const syncStatus = normalizeStatus(
    trip?.offlineSyncStatus || trip?.syncStatus || trip?.validationStatus
  );
  const readObserved = hasHistoricalReadEvidence(trip || {});
  const sdkPending = trip?.historyReadEvidence?.transport === "pending";
  const awaitingServerValidation = trip?.historyLocalCommandOnly === true || sdkPending || !readObserved && [
    "awaiting_connection",
    "pending_sync",
    "local_created",
    "syncing",
    "uploading",
    "server_received",
    "validation_pending",
    "pending_validation",
    "validation_failed",
    "failed"
  ].includes(syncStatus);
  const canceledStatuses = /* @__PURE__ */ new Set([
    "cancelado",
    "cancelada",
    "canceled",
    "cancelled",
    "excluido",
    "excluida",
    "deleted"
  ]);
  const deletedOrCanceled = canceledStatuses.has(status) || trip?.cancelado === true || trip?.deleted === true || trip?.softDeleted === true || Boolean(trip?.deletedAt || trip?.tombstonedAt) || trip?.tripState === "DELETED";
  const completedStatuses = /* @__PURE__ */ new Set([
    "concluida",
    "concluido",
    "completed",
    "finalizado",
    "finalizada",
    "entregue"
  ]);
  const dateResult = getTripMetricDateResult(trip);
  const hasServerConfirmation = Boolean(
    trip?.serverValidatedAt || trip?.syncStatus === "synced" || trip?.offlineSyncStatus === "synced"
  );
  const statusCompleted = completedStatuses.has(status);
  const historicalServerProven = trip?.historicalReadOnly === true && normalizeStatus(trip?.historicalEvidenceStatus) === "server_proven";
  const legacyCompleted = !status && dateResult.valid && (hasServerConfirmation || historicalServerProven || readObserved);
  const eligible = !deletedOrCanceled && !awaitingServerValidation && dateResult.valid && (statusCompleted || legacyCompleted);
  const reasons = [];
  if (deletedOrCanceled) reasons.push("deleted_or_canceled");
  if (awaitingServerValidation) reasons.push("pending_sync_state");
  if (!dateResult.valid) reasons.push("missing_metric_date");
  if (!statusCompleted && !legacyCompleted) {
    reasons.push(status ? "status_not_completed" : "legacy_status_requires_date_and_server_confirmation");
  }
  return {
    ...dateResult,
    eligible,
    status: status || null,
    reason: eligible ? legacyCompleted ? readObserved ? "legacy_historical_read_and_date" : historicalServerProven ? "legacy_server_proven_historical_read" : "legacy_date_and_server_confirmation" : "completed_status_and_date" : reasons.join("+"),
    legacyCompleted,
    awaitingServerValidation,
    deletedOrCanceled
  };
}

// functions/src/tripCurrencyResolver.ts
var knownCurrencies = /* @__PURE__ */ new Set(["BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG"]);
function receiptCurrencyEvidence(trip) {
  const rawField = ["gtoRawText", "receiptText", "simpleReceiptText", "ocrText", "receiptOcrText"].find((field) => String(trip[field] ?? "").trim());
  if (!rawField) return { currencies: [], unsupportedCurrencies: [], ambiguousDollar: false };
  const normalized = String(trip[rawField]).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const simulator = [trip.simulatorKey, trip.simulatorCode, trip.simuladorCodigo, trip.simulatorId, trip.simulatorName, trip.simuladorNome].map((value) => String(value ?? "").toLowerCase()).join(" ");
  const labels = /global[- ]?truck|\bgto\b/.test(simulator) ? ["VALOR A RECEBER"] : /toe[- ]?3|truckers? of europe/.test(simulator) ? ["RENDA TOTAL", "GANHOS"] : /wtds|wbds|world truck|world bus/.test(simulator) ? ["GANHOS DA VIAGEM", "TOTAL"] : ["VALOR A RECEBER", "RENDA TOTAL", "GANHOS DA VIAGEM", "GANHOS", "TOTAL"];
  const currencies = /* @__PURE__ */ new Set();
  const unsupportedCurrencies = /* @__PURE__ */ new Set();
  let ambiguousDollar = false;
  for (const label of labels) {
    let from = normalized.indexOf(label);
    while (from >= 0) {
      const tail = normalized.slice(from + label.length, from + label.length + 160);
      const tokenPattern = /R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$/;
      const money = /(?:R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$)\s*[0-9][0-9.,]*|[0-9][0-9.,]*\s*(?:R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$)/g;
      for (const match of tail.matchAll(money)) {
        const token = match[0].match(tokenPattern)?.[0]?.replace(/\s/g, "");
        if (token === "R$" || token === "BRL") currencies.add("BRL");
        else if (token === "EUR" || token === "\u20AC") currencies.add("EUR");
        else if (token === "USD" || token === "US$") currencies.add("USD");
        else if (token === "$") ambiguousDollar = true;
        else if (token) unsupportedCurrencies.add(token);
      }
      from = normalized.indexOf(label, from + 1);
    }
  }
  return { currencies: [...currencies], unsupportedCurrencies: [...unsupportedCurrencies], ambiguousDollar, source: rawField };
}
function resolveTripCurrency(trip) {
  const fields = ["currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"];
  const observed = fields.flatMap((field) => {
    const currency = String(trip[field] ?? "").trim().toUpperCase();
    return currency ? [{ field, currency }] : [];
  });
  const receipt = receiptCurrencyEvidence(trip);
  const simulator = resolveSimulatorCurrency(trip);
  const normalizedObserved = observed.map((item) => ({ ...item, parsed: normalizeExplicitCurrency(item.currency) }));
  const unsupportedReceipt = receipt.unsupportedCurrencies.map((token) => normalizeExplicitCurrency(token));
  const explicitCurrencies = [.../* @__PURE__ */ new Set([
    ...normalizedObserved.filter((item) => item.parsed.recognized).map((item) => item.parsed.currency),
    ...receipt.currencies,
    ...unsupportedReceipt.filter((item) => item.recognized).map((item) => item.currency)
  ])];
  const verifiedEvidence = Number(trip.currencyEvidenceVersion) === 1 && Boolean(trip.serverValidatedAt) && ["known", "unknown", "conflict"].includes(String(trip.currencyEvidenceStatus ?? "")) && typeof trip.currencyEvidenceSource === "string" && trip.currencyEvidenceSource.startsWith("server_");
  const sources = [
    ...observed.map((item) => item.field),
    ...receipt.source ? [receipt.source] : [],
    ...verifiedEvidence ? [String(trip.currencyEvidenceSource)] : []
  ];
  const conflict = (currencySource) => ({
    currency: void 0,
    currencyStatus: "conflict",
    currencySources: [...sources, currencySource],
    currencySource
  });
  const explicitValidUnsupported = normalizedObserved.some((item) => item.parsed.recognized && !item.parsed.supported) || unsupportedReceipt.some((item) => item.recognized && !item.supported);
  if (simulator.status === "conflict") return conflict("SIMULATOR_METADATA_CONFLICT");
  if (explicitCurrencies.length > 1 || receipt.currencies.length > 1) return conflict("EXPLICIT_CURRENCY_CONFLICT");
  const explicitCurrency = explicitCurrencies[0];
  if (explicitCurrency && simulator.status === "known" && explicitCurrency !== simulator.currency) {
    return conflict("EXPLICIT_SIMULATOR_CONFLICT");
  }
  if (explicitValidUnsupported && simulator.status === "known") return conflict("UNSUPPORTED_EXPLICIT_SIMULATOR_CONFLICT");
  if (verifiedEvidence) {
    const evidenceStatus = String(trip.currencyEvidenceStatus);
    const evidenceCurrency = explicitCurrency || "";
    if (evidenceStatus === "conflict" || evidenceStatus === "known" && (!evidenceCurrency || !knownCurrencies.has(evidenceCurrency))) {
      return conflict("SERVER_EVIDENCE_CONFLICT");
    }
    if (evidenceStatus === "known") return {
      currency: evidenceCurrency,
      currencyStatus: "known",
      currencySources: [...sources, "server_validated_evidence"],
      currencySource: "SERVER_VALIDATED"
    };
  }
  if (explicitCurrency) {
    if (!knownCurrencies.has(explicitCurrency) || explicitValidUnsupported) {
      if (simulator.status === "known") return conflict("UNSUPPORTED_EXPLICIT_SIMULATOR_CONFLICT");
      return { currency: void 0, currencyStatus: "unknown", currencySources: sources, currencySource: "UNKNOWN" };
    }
    return {
      currency: explicitCurrency,
      currencyStatus: "known",
      currencySources: [...sources, ...receipt.currencies.includes(explicitCurrency) ? ["receipt_text_explicit"] : ["explicit_trip_field"]],
      currencySource: verifiedEvidence ? "SERVER_VALIDATED" : receipt.currencies.includes(explicitCurrency) && !normalizedObserved.some((item) => item.parsed.currency === explicitCurrency) ? "EXPLICIT_RECEIPT_TEXT" : "EXPLICIT_TRIP_FIELD"
    };
  }
  if (simulator.status === "known" && simulator.currency) {
    return {
      currency: simulator.currency,
      currencyStatus: "known",
      currencySources: [...sources, "SIMULATOR_REGISTRY"],
      currencySource: "SIMULATOR_REGISTRY"
    };
  }
  return { currency: void 0, currencyStatus: "unknown", currencySources: sources, currencySource: "UNKNOWN" };
}

// src/lib/tripNormalizer.ts
function parseTripValueOrNull(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  let normalized = cleaned;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    const lastDot = cleaned.lastIndexOf(".");
    normalized = cleaned.slice(0, lastDot).replace(/\./g, "") + cleaned.slice(lastDot);
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseTripMoneyRecord(trip) {
  const rawCents = trip.valorCents ?? trip.amountCents ?? trip.earningsCents;
  const hasValidCents = typeof rawCents === "number" && Number.isSafeInteger(rawCents) || typeof rawCents === "string" && /^-?\d+$/.test(rawCents.trim()) && Number.isSafeInteger(Number(rawCents));
  const decimal = [trip.valor, trip.value, trip.totalValue, trip.ganho].find((value) => value !== null && value !== void 0 && String(value).trim() !== "");
  const parsedDecimal = parseTripValueOrNull(decimal);
  const candidateCents = hasValidCents ? Number(rawCents) : parsedDecimal === null ? null : Math.round(parsedDecimal * 100);
  const amountCents = candidateCents !== null && Number.isSafeInteger(candidateCents) ? candidateCents : null;
  const amountSource = amountCents === null ? null : hasValidCents ? "valorCents" : "decimal_fallback";
  return {
    amount: amountCents === null ? 0 : amountCents / 100,
    amountCents,
    amountSource,
    ...resolveTripCurrency(trip)
  };
}
var normalizationCache = /* @__PURE__ */ new WeakMap();
function normalizeTrip(trip) {
  if (typeof trip === "object" && trip !== null) {
    if (normalizationCache.has(trip)) {
      return normalizationCache.get(trip);
    }
  }
  const assessment = getTripMetricAssessment(trip);
  const money = parseTripMoneyRecord(trip);
  return {
    ...trip,
    isValid: assessment.eligible,
    metricDate: assessment.date,
    normalizedValor: money.amount,
    normalizedCurrency: money.currency,
    currencyStatus: money.currencyStatus,
    currencySource: money.currencySource
  };
}

// src/lib/tripMoneySummary.ts
function summarizeTripMoney(trips) {
  const groups = /* @__PURE__ */ new Map();
  for (const trip of trips) {
    const money = parseTripMoneyRecord(trip);
    const comparable = money.currencyStatus === "known" && Boolean(money.currency);
    const key = comparable ? money.currency : `${money.currencyStatus}:${money.currency || ""}`;
    const group = groups.get(key) || {
      currency: money.currency,
      currencyStatus: money.currencyStatus,
      currencySources: [],
      value: null,
      tripCount: 0,
      missingValueTrips: 0,
      cents: 0,
      valuedTrips: 0,
      overflow: false
    };
    if (money.currencySource && !group.currencySources.includes(money.currencySource)) group.currencySources.push(money.currencySource);
    group.tripCount++;
    if (money.amountCents === null || !Number.isSafeInteger(money.amountCents)) group.missingValueTrips++;
    else if (comparable) {
      group.valuedTrips++;
      group.cents += money.amountCents;
      if (!Number.isSafeInteger(group.cents)) group.overflow = true;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(({ cents, valuedTrips, overflow, ...group }) => ({
    ...group,
    currencySource: group.currencySources.length === 1 ? group.currencySources[0] : group.currencySources.length ? "MIXED" : void 0,
    value: group.currencyStatus === "known" && valuedTrips > 0 && !overflow ? cents / 100 : null
  }));
}

// src/lib/tripIdentity.ts
function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === void 0 || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return void 0;
}
function getCanonicalTripDriverId(trip) {
  return firstNonEmpty(
    trip?.motoristaId,
    trip?.driverId,
    trip?.motorista_id,
    trip?.userId,
    trip?.driver_id
  );
}
function getCanonicalTripCompanyId(trip) {
  return firstNonEmpty(
    trip?.empresaId,
    trip?.companyId,
    trip?.company_id,
    trip?.empresa_id
  );
}
function getCanonicalTripDriverName(trip) {
  return firstNonEmpty(
    trip?.motoristaNome,
    trip?.driverName,
    trip?.motorista_nome,
    trip?.nomeMotorista,
    trip?.driver_name
  );
}

// src/lib/performanceEngine.ts
function tripDate(trip) {
  return getTripMetricDate(trip);
}
function driverIdOf(trip) {
  return getCanonicalTripDriverId(trip);
}
function companyIdOf(trip) {
  return getCanonicalTripCompanyId(trip);
}
function driverNameOf(trip) {
  return getCanonicalTripDriverName(trip);
}
function buildDriverRankingContext(trips, query) {
  const start = query.startDate.getTime();
  const end = query.endDate.getTime();
  const periodTrips = trips.map(
    (trip) => typeof trip?.isValid === "boolean" && trip?.metricDate instanceof Date ? trip : normalizeTrip(trip)
  ).filter((trip) => {
    if (!trip.isValid) return false;
    const time = tripDate(trip).getTime();
    return Number.isFinite(time) && time >= start && time <= end;
  }).sort((left, right) => {
    const dateOrder = tripDate(left).getTime() - tripDate(right).getTime();
    if (dateOrder !== 0) return dateOrder;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
  const eligibleCompanyIds = query.eligibleCompanyIds ? new Set(
    query.eligibleCompanyIds.map((id) => String(id || "").trim()).filter(Boolean)
  ) : null;
  const scopedPeriodTrips = periodTrips.filter((trip) => {
    const companyId = companyIdOf(trip);
    if (query.scope === "internal" && query.companyId) {
      return companyId === query.companyId;
    }
    return !eligibleCompanyIds || eligibleCompanyIds.has(companyId || "");
  });
  const canonicalStats = /* @__PURE__ */ new Map();
  const tripsByDriver = /* @__PURE__ */ new Map();
  for (const trip of scopedPeriodTrips) {
    const id = driverIdOf(trip);
    if (!id) continue;
    const current2 = canonicalStats.get(id) || {
      id,
      name: driverNameOf(trip),
      companyId: companyIdOf(trip),
      trips: 0,
      earnings: 0
    };
    if (!current2.name) current2.name = driverNameOf(trip);
    if (query.scope === "global") {
      current2.companyId = companyIdOf(trip) || current2.companyId;
    } else if (!current2.companyId) {
      current2.companyId = companyIdOf(trip);
    }
    current2.trips += 1;
    const driverTrips = tripsByDriver.get(id) || [];
    driverTrips.push(trip);
    tripsByDriver.set(id, driverTrips);
    canonicalStats.set(id, current2);
  }
  const overallMoneyGroups = summarizeTripMoney(scopedPeriodTrips);
  const overallKnown = overallMoneyGroups.filter((group) => group.currencyStatus === "known");
  const overallUnresolved = overallMoneyGroups.some((group) => group.currencyStatus !== "known");
  const overallMissingValues = overallKnown.some((group) => group.missingValueTrips > 0);
  const comparableCurrency = overallKnown.length === 1 && !overallUnresolved && !overallMissingValues ? overallKnown[0]?.currency : void 0;
  const eligibleDriverIds = /* @__PURE__ */ new Set();
  canonicalStats.forEach((_entry, id) => eligibleDriverIds.add(id));
  const ranking = Array.from(eligibleDriverIds).map((id) => canonicalStats.get(id)).filter((entry) => Boolean(entry)).map((entry) => {
    const groups = summarizeTripMoney(tripsByDriver.get(entry.id) || []);
    const known = groups.filter((group) => group.currencyStatus === "known" && group.currency);
    const unresolvedTrips = groups.filter((group) => group.currencyStatus !== "known").reduce((sum, group) => sum + group.tripCount, 0);
    const currencyBreakdown = known.map((group) => ({
      currency: group.currency,
      value: group.value ?? 0,
      tripCount: group.tripCount,
      missingValueTrips: group.missingValueTrips,
      currencySource: group.currencySource,
      currencySources: group.currencySources
    }));
    return {
      ...entry,
      earnings: comparableCurrency ? known.find((group) => group.currency === comparableCurrency)?.value ?? 0 : 0,
      currency: comparableCurrency,
      currencyBreakdown,
      currencyUnresolvedTrips: unresolvedTrips
    };
  }).sort((a, b) => {
    if (comparableCurrency && b.earnings !== a.earnings) return b.earnings - a.earnings;
    if (b.trips !== a.trips) return b.trips - a.trips;
    const nameOrder = String(a.name || "").localeCompare(
      String(b.name || ""),
      "pt-BR",
      { sensitivity: "base", numeric: true }
    );
    return nameOrder || a.id.localeCompare(b.id);
  });
  const index = ranking.findIndex((entry) => entry.id === query.driverId);
  const current = canonicalStats.get(query.driverId) || {
    id: query.driverId,
    companyId: query.companyId || void 0,
    trips: 0,
    earnings: 0,
    currencyBreakdown: [],
    currencyUnresolvedTrips: 0
  };
  const hasActivity = current.trips > 0;
  const position = hasActivity && index >= 0 ? index + 1 : null;
  const nextCompetitor = hasActivity && index > 0 ? ranking[index - 1] : null;
  const differenceToNext = nextCompetitor ? Math.max(0, nextCompetitor.earnings - current.earnings) : 0;
  return {
    scope: query.scope,
    ranking,
    position,
    totalParticipants: ranking.length,
    differenceToNext,
    nextCompetitor,
    current,
    entityTrips: scopedPeriodTrips.filter(
      (trip) => driverIdOf(trip) === query.driverId
    ),
    periodTrips: scopedPeriodTrips
  };
}

// src/lib/metricsEngine.ts
var readEntityText2 = (record, key) => {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
};
function getTripCompany(trip, companies) {
  const tripCompanyId = getCanonicalTripCompanyId(trip);
  if (!tripCompanyId) return void 0;
  return companies.find((company) => String(company?.id) === String(tripCompanyId));
}
function applySimulatorCurrencyContext(trip, companies, simulators) {
  const simulatorId = getTripSimulatorId(trip, companies, simulators);
  if (!simulatorId) return trip;
  const simulator = simulators.find((item) => String(item?.id || "") === simulatorId);
  const company = getTripCompany(trip, companies);
  const contextAliases = [
    readEntityText2(simulator, "code"),
    readEntityText2(simulator, "slug"),
    readEntityText2(simulator, "key"),
    readEntityText2(simulator, "name"),
    readEntityText2(simulator, "label"),
    readEntityText2(simulator, "title"),
    readEntityText2(company, "simulatorCode"),
    readEntityText2(company, "simuladorCodigo"),
    readEntityText2(company, "simulatorName"),
    readEntityText2(company, "simuladorNome"),
    readEntityText2(company, "simulatorKey"),
    readEntityText2(company, "simuladorKey"),
    simulatorId
  ].filter(Boolean);
  if (!contextAliases.length) return trip;
  const currencyRecord = { ...trip };
  const simulatorFields2 = ["simulatorCode", "simulatorName", "simulatorKey", "simulator", "simulatorId", "simuladorCodigo", "simuladorNome", "simuladorKey", "simulador", "simuladorId", "gameCode", "packageId"];
  contextAliases.forEach((alias) => {
    const emptyField = simulatorFields2.find((field) => !String(currencyRecord[field] ?? "").trim());
    if (emptyField) currencyRecord[emptyField] = alias;
  });
  const money = parseTripMoneyRecord(currencyRecord);
  return {
    ...trip,
    normalizedCurrency: money.currency,
    currencyStatus: money.currencyStatus,
    currencySource: money.currencySource,
    ...Object.fromEntries(simulatorFields2.filter((field) => currencyRecord[field] !== void 0).map((field) => [field, currencyRecord[field]]))
  };
}
function getTripSimulatorId(trip, companies = [], simulators = []) {
  const tripRecord = trip;
  const company = getTripCompany(tripRecord, companies);
  if (company && hasSimulatorIdentity(company)) {
    return resolveSimulatorId(company, simulators, companies);
  }
  return hasSimulatorIdentity(tripRecord) ? resolveSimulatorId(tripRecord, simulators, companies) : "";
}
function createTripSimulatorMatcher(simulatorId, companies, simulators) {
  if (!simulatorId || isAllSimulatorSelection(simulatorId)) {
    return (_trip) => true;
  }
  const canonicalTargetId = resolveSimulatorId(
    { simulatorId },
    simulators,
    companies
  );
  if (!canonicalTargetId) return (_trip) => false;
  const companiesById = new Map(
    companies.map((company) => [String(company?.id || ""), company]).filter(([id]) => Boolean(id))
  );
  const companySimulatorIds = /* @__PURE__ */ new Map();
  return (trip) => {
    const tripRecord = trip;
    const companyId = getCanonicalTripCompanyId(tripRecord);
    if (companyId) {
      let resolvedCompanySimulatorId = companySimulatorIds.get(companyId);
      if (resolvedCompanySimulatorId === void 0) {
        const company = companiesById.get(companyId);
        resolvedCompanySimulatorId = company ? resolveSimulatorId(company, simulators, companies) : "";
        companySimulatorIds.set(companyId, resolvedCompanySimulatorId);
      }
      if (resolvedCompanySimulatorId) {
        return resolvedCompanySimulatorId === canonicalTargetId;
      }
    }
    return hasSimulatorIdentity(tripRecord) ? resolveSimulatorId(tripRecord, simulators, companies) === canonicalTargetId : false;
  };
}
function filterTripsBySimulator(trips, simulatorId, companies = [], simulators = []) {
  if (!simulatorId || isAllSimulatorSelection(simulatorId)) return trips;
  const matchesSimulator = createTripSimulatorMatcher(
    simulatorId,
    companies,
    simulators
  );
  return trips.filter(matchesSimulator).map((trip) => applySimulatorCurrencyContext(trip, companies, simulators));
}

// src/lib/rankingPageEngine.ts
function buildCanonicalDriverRankingContext({
  trips,
  startDate,
  endDate,
  scope,
  companyId,
  simulatorId,
  tripsAlreadyFilteredBySimulator = false,
  companies = [],
  simulators = [],
  driverId
}) {
  if (scope === "internal" && !companyId) {
    return buildDriverRankingContext([], {
      scope,
      startDate: startDate || /* @__PURE__ */ new Date(0),
      endDate: endDate || /* @__PURE__ */ new Date(),
      driverId,
      companyId
    });
  }
  const simulatorTrips = tripsAlreadyFilteredBySimulator ? trips : filterTripsBySimulator(trips, simulatorId, companies, simulators);
  const eligibleCompanyIds = scope === "global" ? companies.filter((company) => {
    if (!isRankingEligibleCompany(company)) return false;
    if (!simulatorId || isAllSimulatorSelection(simulatorId))
      return true;
    const selectedSimulatorId = resolveSimulatorId(
      { simulatorId },
      simulators,
      companies
    );
    return resolveSimulatorId(company, simulators, companies) === selectedSimulatorId;
  }).map((company) => String(company.id || "").trim()).filter(Boolean) : void 0;
  return buildDriverRankingContext(simulatorTrips, {
    scope,
    startDate: startDate || /* @__PURE__ */ new Date(0),
    endDate: endDate || /* @__PURE__ */ new Date(),
    driverId,
    companyId,
    eligibleCompanyIds
  });
}
function shortDriverName2(value) {
  const name = String(value || "Motorista Desconhecido").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Motorista Desconhecido";
}
function buildDriverRankingPageData({
  trips,
  startDate,
  endDate,
  scope,
  companyId,
  simulatorId,
  tripsAlreadyFilteredBySimulator = false,
  companies = [],
  simulators = [],
  users = [],
  companyMembers = []
}) {
  if (scope === "internal" && !companyId) return [];
  const readSimulatorText = (record, ...keys) => {
    for (const key of keys) {
      const value = record?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const canonicalSimulatorId = simulatorId ? resolveSimulatorId({ simulatorId }, simulators, companies) : "";
  const simulatorCatalogEntry = simulators.find(
    (item) => readSimulatorText(item, "id") === canonicalSimulatorId
  );
  const catalogSimulatorCode = readSimulatorText(
    simulatorCatalogEntry,
    "simulatorCode",
    "simuladorCodigo",
    "code",
    "slug",
    "key"
  );
  const catalogSimulatorName = readSimulatorText(
    simulatorCatalogEntry,
    "simulatorName",
    "simuladorNome",
    "name",
    "nome",
    "label",
    "title",
    "displayName"
  );
  const currencyAwareTrips = trips.map((trip) => {
    if (!canonicalSimulatorId || resolveSimulatorId(trip, simulators, companies) !== canonicalSimulatorId) return trip;
    return {
      ...trip,
      simulatorCode: readSimulatorText(trip, "simulatorCode", "simuladorCodigo") || catalogSimulatorCode || void 0,
      simulatorName: readSimulatorText(trip, "simulatorName", "simuladorNome", "simulator", "simulador") || catalogSimulatorName || void 0
    };
  });
  const context = buildCanonicalDriverRankingContext({
    trips: currencyAwareTrips,
    startDate,
    endDate,
    scope,
    companyId,
    simulatorId,
    tripsAlreadyFilteredBySimulator,
    companies,
    simulators,
    // The ranking page needs the ordered population, not a specific driver's
    // position. A sentinel ID keeps the shared engine deterministic.
    driverId: "__ranking_page__"
  });
  const readText2 = (record, key) => {
    const value = record?.[key];
    return typeof value === "string" ? value : "";
  };
  const usersById = new Map(
    users.map((user) => [readText2(user, "id"), user]).filter(([id]) => Boolean(id))
  );
  const companiesById = new Map(
    companies.map((company) => [readText2(company, "id"), company]).filter(([id]) => Boolean(id))
  );
  const activeMembershipByUser = /* @__PURE__ */ new Map();
  companyMembers.forEach((membership) => {
    const userId = readText2(membership, "userId");
    const membershipCompanyId = readText2(membership, "companyId");
    const roles = Array.isArray(membership.roles) ? membership.roles.map((role) => String(role).toLowerCase()) : [];
    const isDriver = roles.includes("driver") || readText2(membership, "role").toLowerCase() === "driver";
    if (!userId || !membershipCompanyId || readText2(membership, "status").toLowerCase() !== "active" || !isDriver || !companiesById.has(membershipCompanyId) || scope === "internal" && membershipCompanyId !== companyId) {
      return;
    }
    const membershipCompany = companiesById.get(membershipCompanyId);
    if (canonicalSimulatorId && !isAllSimulatorSelection(canonicalSimulatorId) && resolveSimulatorId(membershipCompany, simulators, companies) !== canonicalSimulatorId) {
      return;
    }
    const joinedAtValue = membership.joinedAt;
    const joinedAt = joinedAtValue instanceof Date ? joinedAtValue.getTime() : typeof joinedAtValue?.toDate === "function" ? joinedAtValue.toDate().getTime() : new Date(joinedAtValue).getTime() || 0;
    const current = activeMembershipByUser.get(userId);
    if (!current || joinedAt >= current.joinedAt) {
      activeMembershipByUser.set(userId, {
        companyId: membershipCompanyId,
        joinedAt
      });
    }
  });
  return context.ranking.map((entry) => {
    const user = usersById.get(entry.id);
    const currentCompanyId = scope === "internal" ? companyId || entry.companyId : activeMembershipByUser.get(entry.id)?.companyId || entry.companyId;
    const company = currentCompanyId ? companiesById.get(currentCompanyId) : void 0;
    return {
      id: entry.id,
      // The user document is the canonical identity after approval. Trip
      // snapshots intentionally keep their historical motoristaNome for
      // auditability, but must not overwrite a newer approved profile name.
      name: shortDriverName2(user ? driverDisplayIdentity(user).name : entry.name),
      logo: driverDisplayIdentity(user).profilePhotoURL,
      trips: entry.trips,
      val: entry.earnings,
      currency: entry.currency,
      currencyBreakdown: entry.currencyBreakdown,
      currencyUnresolvedTrips: entry.currencyUnresolvedTrips,
      currencyTotals: Object.fromEntries(
        (entry.currencyBreakdown || []).map((group) => [group.currency, group.value])
      ),
      currencyTripCounts: Object.fromEntries(
        (entry.currencyBreakdown || []).map((group) => [group.currency, group.tripCount])
      ),
      currencyMissingValueTrips: (entry.currencyBreakdown || []).reduce(
        (sum, group) => sum + group.missingValueTrips,
        0
      ),
      companyId: currentCompanyId,
      companyName: readText2(company, "companyName") || readText2(company, "name"),
      companyLogo: readText2(company, "logoUrl") || readText2(company, "logoURL") || readText2(company, "companyLogoURL")
    };
  });
}
function getActiveInternalDriverIds(companyMembers, companyId) {
  if (!companyId) return [];
  return Array.from(
    new Set(
      companyMembers.filter((member) => {
        const roles = Array.isArray(member.roles) ? member.roles.map((role) => String(role).toLowerCase()) : [];
        return String(member.companyId || "") === companyId && String(member.status || "").toLowerCase() === "active" && (roles.includes("driver") || String(member.role || "").toLowerCase() === "driver");
      }).map((member) => String(member.userId || "").trim()).filter(Boolean)
    )
  ).sort();
}
function buildInternalDriverRankingPageData(params) {
  const companyId = params.companyId || "";
  if (!companyId) return [];
  const selectedCompany = (params.companies || []).find(
    (company2) => String(company2.id || "") === companyId
  );
  if (!isRankingEligibleCompany(selectedCompany)) return [];
  const ranking = buildDriverRankingPageData({ ...params, scope: "internal" });
  const existingIds = new Set(ranking.map((entry) => entry.id));
  const usersById = new Map(
    (params.users || []).map((user) => [String(user.id || ""), user])
  );
  const company = (params.companies || []).find(
    (item) => String(item.id || "") === companyId
  );
  const zeroActivityDrivers = getActiveInternalDriverIds(
    params.companyMembers || [],
    companyId
  ).filter((id) => !existingIds.has(id)).map((id) => {
    const user = usersById.get(id);
    return {
      id,
      name: shortDriverName2(driverDisplayIdentity(user).name),
      logo: driverDisplayIdentity(user).profilePhotoURL,
      trips: 0,
      val: 0,
      companyId,
      companyName: String(company?.companyName || company?.name || "")
    };
  });
  return [...ranking, ...zeroActivityDrivers].sort((left, right) => {
    if (right.val !== left.val) return right.val - left.val;
    if (right.trips !== left.trips) return right.trips - left.trips;
    const nameOrder = left.name.localeCompare(right.name, "pt-BR", {
      sensitivity: "base",
      numeric: true
    });
    return nameOrder || left.id.localeCompare(right.id);
  });
}

// src/lib/profileRanking.ts
function summarizeProfileRanking(ranking, participantId) {
  const index = ranking.findIndex((entry) => entry.id === participantId);
  const current = index >= 0 ? ranking[index] : null;
  const leader = ranking[0] || null;
  const next = index > 0 ? ranking[index - 1] : null;
  const hasActivity = Boolean(current && current.trips > 0);
  const comparableCurrency = Boolean(current?.currency && leader?.currency && current.currency === leader.currency);
  const leaderRatio = comparableCurrency && current && leader && leader.val > 0 ? Math.min(100, Math.max(0, current.val / leader.val * 100)) : null;
  return {
    current,
    leader,
    next,
    position: index >= 0 ? index + 1 : null,
    total: ranking.length,
    activeParticipants: ranking.filter((entry) => entry.trips > 0).length,
    hasActivity,
    comparableCurrency,
    isLeader: index === 0 && hasActivity,
    gapToNext: comparableCurrency && current && next ? Math.max(0, next.val - current.val) : null,
    gapToLeader: comparableCurrency && current && leader ? Math.max(0, leader.val - current.val) : null,
    leaderRatio
  };
}

// src/hooks/useProfileRanking.ts
function useProfileRanking(query) {
  const enabled = query.enabled !== false;
  const internal = query.scope === "internal";
  const simulatorId = resolveSimulatorId(
    { simulatorId: query.simulatorId },
    query.simulators,
    query.companies
  );
  const supported = Boolean(
    simulatorId && simulatorId !== "all" && (!internal || query.companyId)
  );
  const aggregateState = useRankingAggregate({
    simulatorId,
    periodType: query.periodType,
    periodKey: buildRankingAggregatePeriodKey(query.periodType, query.start),
    enabled: enabled && supported && !internal,
    refreshOnRead: query.end.getTime() >= Date.now()
  });
  const aggregate = aggregateState.status === "ready" ? aggregateState.aggregate : null;
  const aggregateCompanyIds = useMemo(() => {
    if (internal && query.companyId) return [query.companyId];
    if (!aggregate) return [];
    return Array.from(
      new Set(
        [
          ...Object.keys(aggregate.companies),
          ...Object.values(aggregate.drivers).map(
            (driver) => driver.companyId || ""
          )
        ].filter(Boolean)
      )
    ).sort();
  }, [aggregate, internal, query.companyId]);
  const companyState = useRankingCompaniesByIds(
    aggregateCompanyIds,
    enabled && supported && (internal || Boolean(aggregate))
  );
  const companies = useMemo(() => {
    return mergeRankingCompanyCatalogs(
      query.companies,
      companyState.companies,
      companyState.complete && companyState.serverConfirmed ? aggregateCompanyIds : []
    );
  }, [
    aggregateCompanyIds,
    companyState.companies,
    companyState.complete,
    companyState.serverConfirmed,
    query.companies
  ]);
  const requestedTripState = useTripsRealtime({
    startDate: query.start,
    endDate: query.end,
    companyIds: query.companyId ? [query.companyId] : [],
    enabled: enabled && supported && internal && !query.internalSource,
    keepPreviousData: false
  });
  const tripState = query.internalSource || requestedTripState;
  const participantIds = useMemo(() => {
    if (query.scope === "companies") return [];
    if (!internal)
      return aggregate ? Object.keys(aggregate.drivers).sort() : [];
    return Array.from(
      new Set(
        [
          ...getActiveInternalDriverIds(
            query.companyMembers || [],
            query.companyId || ""
          ),
          ...tripState.trips.filter((trip) => trip.isValid).map((trip) => getCanonicalTripDriverId(trip) || "")
        ].filter(Boolean)
      )
    ).sort();
  }, [
    aggregate,
    internal,
    query.companyId,
    query.companyMembers,
    query.scope,
    tripState.trips
  ]);
  const userState = useRankingUsersRealtime(
    participantIds,
    enabled && supported && query.scope !== "companies"
  );
  const users = useMemo(() => {
    const byId = /* @__PURE__ */ new Map();
    [...query.users || [], ...userState.users].forEach((user) => {
      if (user.id) byId.set(String(user.id), user);
    });
    return Array.from(byId.values());
  }, [query.users, userState.users]);
  const ranking = useMemo(() => {
    if (!supported) return [];
    if (internal)
      return buildInternalDriverRankingPageData({
        trips: tripState.trips,
        startDate: query.start,
        endDate: query.end,
        companyId: query.companyId,
        simulatorId,
        companies,
        simulators: query.simulators,
        users,
        companyMembers: query.companyMembers
      });
    if (!aggregate) return [];
    return query.scope === "companies" ? buildCompanyRankingFromAggregate(aggregate, companies, query.simulators) : buildDriverRankingFromAggregate(
      aggregate,
      users,
      companies,
      query.simulators,
      query.companyMembers
    );
  }, [
    aggregate,
    companies,
    internal,
    query.companyId,
    query.companyMembers,
    query.end,
    query.scope,
    query.simulators,
    query.start,
    simulatorId,
    supported,
    tripState.trips,
    users
  ]);
  const metadataReady = aggregateCompanyIds.length === 0 || companyState.complete && companyState.serverConfirmed && !companyState.loading;
  const error = internal ? tripState.error || (companyState.complete ? null : companyState.error) : aggregateState.error || (companyState.complete ? null : companyState.error);
  const ready = internal ? tripState.serverConfirmed && metadataReady && !tripState.refreshing && !error : Boolean(aggregate && metadataReady && !error);
  const status = !enabled ? "idle" : !supported || error || aggregateState.status === "unavailable" ? "unavailable" : !internal && aggregateState.status === "missing" ? "missing" : ready ? "ready" : "loading";
  const summary = useMemo(
    () => summarizeProfileRanking(status === "ready" ? ranking : [], query.participantId),
    [status, ranking, query.participantId]
  );
  return {
    status,
    error,
    stale: Boolean(!internal && aggregateState.stale || companyState.stale || companyState.refreshing || companyState.error),
    simulatorId,
    // Incomplete comparative data never produces a visible position or leader.
    summary
  };
}
export {
  useProfileRanking
};
