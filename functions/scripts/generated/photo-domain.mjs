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

// src/lib/vehiclePhotoIdentity.ts
function resolveVehiclePhotoSimulatorId(source, simulators = [], companies = []) {
  const resolved = resolveSimulatorId(source, simulators, companies);
  if (!resolved || resolved === "all") return "";
  const aliases = collectSimulatorAliases(source);
  const catalogEntry = simulators.find((entry) => entry.id === resolved);
  collectSimulatorAliases(catalogEntry, true).forEach((alias) => aliases.add(alias));
  for (const code of ["gto", "wtds", "wbds", "toe3", "ets2", "ats", "pbs"]) {
    if (aliases.has(code)) return code;
  }
  const opaque = /^[a-z0-9_-]{18,}$/i.test(resolved) && /[a-z]/.test(resolved) && /[0-9]/.test(resolved);
  if (opaque && !catalogEntry) return "";
  return resolved;
}
function resolveVehiclePhotoOperationSimulatorEvidence(operation, company, selectedSimulatorId, simulators = [], companies = [], additionalEvidence = []) {
  const explicit = (source) => {
    if (!source || typeof source !== "object") return { simulatorId: "", conflict: false };
    const value = source;
    const keys = ["simulatorId", "simuladorId", "simulatorName", "simuladorNome", "simulator"];
    const ids = keys.flatMap((key) => {
      const candidate = value[key];
      if (typeof candidate !== "string" || !candidate.trim()) return [];
      const simulatorId = resolveVehiclePhotoSimulatorId({ simulatorId: candidate }, simulators, companies);
      return simulatorId ? [simulatorId] : [];
    });
    return { simulatorId: ids[0] || "", conflict: new Set(ids).size > 1 };
  };
  const selected = selectedSimulatorId && selectedSimulatorId !== "all" ? resolveVehiclePhotoSimulatorId({ simulatorId: selectedSimulatorId }, simulators, companies) : "";
  const sources = [operation, company, ...additionalEvidence].map(explicit);
  const known = sources.map((item) => item.simulatorId).filter(Boolean);
  const evidence = [...known, selected].filter(Boolean);
  const conflict = sources.some((item) => item.conflict) || new Set(evidence).size > 1;
  return { simulatorId: conflict || !known.length ? "" : known[0], conflict };
}
function resolveVehiclePhotoOperationSimulatorId(operation, company, selectedSimulatorId, simulators = [], companies = [], additionalEvidence = []) {
  return resolveVehiclePhotoOperationSimulatorEvidence(
    operation,
    company,
    selectedSimulatorId,
    simulators,
    companies,
    additionalEvidence
  ).simulatorId;
}
function vehiclePhotoKey(identity) {
  const fields = [identity.userId, identity.simulatorId, identity.vehicleId];
  if (fields.some((value) => !String(value || "").trim())) {
    throw new Error("VEHICLE_PHOTO_IDENTITY_REQUIRED");
  }
  return `nvu-vehicle-photo:v2:${fields.map((value) => encodeURIComponent(value.trim())).join(":")}`;
}
function vehiclePhotoDocumentKey(identity) {
  vehiclePhotoKey(identity);
  return [identity.simulatorId, identity.vehicleId].map((value) => encodeURIComponent(value.trim())).join(":");
}
function rankingVehiclePhotoDocumentKey(identity) {
  vehiclePhotoKey(identity);
  return [identity.userId, identity.simulatorId, identity.vehicleId].map((value) => encodeURIComponent(value.trim())).join(":");
}

// src/lib/jobStatus.ts
var RUNNING_JOB_STATUSES = [
  "active",
  "awaiting_completion",
  "delayed"
];
var normalizeJobStatus = (status) => String(status || "").trim().toLowerCase();
var isRunningJobStatus = (status) => RUNNING_JOB_STATUSES.includes(normalizeJobStatus(status));

// functions/src/simulatorCurrencyRegistry.ts
var SIMULATOR_CURRENCY_REGISTRY = [
  { simulator: "GTO", currency: "BRL", aliases: ["GTO", "GLOBAL TRUCK", "GLOBAL TRUCK ONLINE", "COM.STARGAMESAPPS.GTO"] },
  { simulator: "WTDS", currency: "BRL", aliases: ["WTDS", "WORLD TRUCK DRIVING SIMULATOR"] },
  { simulator: "WBDS", currency: "BRL", aliases: ["WBDS", "WORLD BUS DRIVING SIMULATOR"] },
  { simulator: "TOE3", currency: "EUR", aliases: ["TOE3", "TOE 3", "TRUCKERS OF EUROPE 3"] }
];
function normalizeSimulatorAlias(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}
var aliasIndex = /* @__PURE__ */ new Map();
for (const entry of SIMULATOR_CURRENCY_REGISTRY) {
  for (const alias of entry.aliases) aliasIndex.set(normalizeSimulatorAlias(alias), entry);
}

// src/lib/currentOperation.ts
var toMillis = (value) => {
  if (!value) return 0;
  try {
    let millis;
    if (typeof value === "object" && value !== null && "toMillis" in value && typeof value.toMillis === "function") {
      millis = value.toMillis();
    } else if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
      millis = value.toDate().getTime();
    } else if (typeof value === "object" && value !== null && "seconds" in value) {
      millis = Number(value.seconds) * 1e3;
    } else {
      millis = typeof value === "number" ? value : new Date(value).getTime();
    }
    return Number.isFinite(millis) && millis > 0 ? millis : 0;
  } catch {
    return 0;
  }
};
var operationSelectionDriverId = (job) => String(job.driverId || job.motoristaId || job.motorista_id || job.assignedDriverId || job.driver_id || "").trim();
var companyIdOf = (job) => String(job.companyId || job.empresaId || "").trim();
var operationAssignmentTimestamp = (job) => toMillis(job.assignedAt) || toMillis(job.startedAt) || toMillis(job.createdAt) || toMillis(job.updatedAt);
var statusPriority = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "awaiting_completion":
      return 0;
    case "active":
      return 1;
    case "delayed":
      return 2;
    case "pending":
      return 3;
    default:
      return 4;
  }
};
function selectCurrentOperationJob(jobs, driverId, companyId) {
  const normalizedDriverId = String(driverId || "").trim();
  const normalizedCompanyId = String(companyId || "").trim();
  if (!normalizedDriverId) return null;
  const scopedJobs = jobs.filter((job) => operationSelectionDriverId(job) === normalizedDriverId && (!normalizedCompanyId || companyIdOf(job) === normalizedCompanyId));
  const completedAssignment = scopedJobs.reduce((latest, job) => String(job.status || "").toLowerCase() === "completed" ? Math.max(latest, operationAssignmentTimestamp(job)) : latest, 0);
  return scopedJobs.filter((job) => isRunningJobStatus(job.status) && (!completedAssignment || operationAssignmentTimestamp(job) >= completedAssignment)).slice().sort((a, b) => {
    const timestampDiff = operationAssignmentTimestamp(b) - operationAssignmentTimestamp(a);
    if (timestampDiff !== 0) return timestampDiff;
    const statusDiff = statusPriority(a.status) - statusPriority(b.status);
    if (statusDiff !== 0) return statusDiff;
    return String(b.id || "").localeCompare(String(a.id || ""));
  })[0] || null;
}
export {
  operationAssignmentTimestamp,
  operationSelectionDriverId,
  rankingVehiclePhotoDocumentKey,
  resolveVehiclePhotoOperationSimulatorEvidence,
  resolveVehiclePhotoOperationSimulatorId,
  resolveVehiclePhotoSimulatorId,
  selectCurrentOperationJob,
  vehiclePhotoDocumentKey
};
