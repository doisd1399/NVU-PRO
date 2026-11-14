const text = (value) => String(value ?? "").trim();
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
const increment = (map, key, amount = 1) => { map[key] = (map[key] || 0) + amount; };
const COMPANY_FIELDS = ["companyId", "company_id", "empresaId", "empresa_id", "fleetId", "frotaId", "canonicalCompanyId", "historicalCompanyId", "originalCompanyId", "companyIdOriginal", "empresaOriginalId", "legacyCompanyId"];
const JOB_FIELDS = ["jobId", "operationId", "trabalhoId"];
const CONTRACT_FIELDS = ["contractId", "contratoId"];
const TRIP_ID_FIELDS = ["canonicalTripId", "tripId", "deterministicTripId", "originalCanonicalTripId", "originalTripId", "idempotencyKey", "clientRequestId", "fingerprint", "receiptEventKey", "simpleReceiptCaptureAttemptId"];
const SLOT_ID_FIELDS = ["canonicalTripId", "tripId", "deterministicTripId", "originalCanonicalTripId", "originalTripId"];
const CREATED_FIELDS = ["createdAt", "createdAtLocal", "localCreatedAt", "offlineCreatedAt"];
const SAFE_SOURCE_VALUES = new Set([
  "gto_auto", "canonical_app", "simple_auto", "simple_automation", "pro_simple_automation",
  "simple-native-v1", "gto_print", "legacy_import", "manual", "print", "offline",
]);
const SAFE_SCHEMA_GENERATIONS = new Set([
  "LEGACY_PRE_CANONICAL_JOB_BOUND", "LEGACY_UNBOUND_HISTORICAL", "LEGACY_SERVER_GTO_V18", "CANONICAL_V4", "UNKNOWN",
]);

function hasValue(row, field) {
  const value = row?.[field];
  return value !== undefined && value !== null && text(value) !== "";
}
function presence(row, fieldNames) {
  return fieldNames.some((field) => hasValue(row, field));
}
function bucketSource(value) {
  const normalized = text(value).toLowerCase();
  return !normalized ? "MISSING" : SAFE_SOURCE_VALUES.has(normalized) ? normalized : "OTHER_OR_UNKNOWN";
}
function bucketVersion(value) {
  const raw = text(value);
  if (!raw) return "MISSING";
  if (/^\d+(?:\.\d+){0,3}$/.test(raw)) return raw;
  if (/^v\d+(?:[._-][a-z0-9]+)*$/i.test(raw)) return raw.toLowerCase();
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(raw) && raw.length <= 48) return raw;
  return "OTHER_OR_UNKNOWN";
}
function bucketCurrency(value) {
  const raw = text(value).toUpperCase().replace(/\s+/g, " ");
  if (!raw) return "MISSING";
  if (["BRL", "R$", "R$ BRL"].includes(raw)) return "BRL";
  if (["EUR", "€"].includes(raw)) return "EUR";
  if (raw === "USD" || raw === "US$") return "USD";
  return "OTHER_OR_UNKNOWN";
}
function creationPeriod(row) {
  for (const field of CREATED_FIELDS) {
    if (!hasValue(row, field)) continue;
    const value = row[field];
    const milliseconds = value instanceof Date ? value.getTime()
      : typeof value === "number" ? value
        : value && typeof value === "object" && Number.isFinite(Number(value.seconds)) ? Number(value.seconds) * 1000
          : Date.parse(String(value));
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      return { field, month: new Date(milliseconds).toISOString().slice(0, 7) };
    }
    return { field: `${field}:INVALID`, month: "UNKNOWN" };
  }
  return { field: "MISSING", month: "UNKNOWN" };
}
function aliases(row, fields) { return unique(fields.map((field) => row?.[field])); }
function resolveCompanyRefs(row, companyMap) {
  const refs = aliases(row, COMPANY_FIELDS);
  const ids = new Set();
  let unresolved = false;
  let ambiguous = false;
  for (const ref of refs) {
    const matches = companyMap.get(ref);
    if (!matches?.size) { unresolved = true; continue; }
    if (matches.size !== 1) { ambiguous = true; continue; }
    ids.add([...matches][0]);
  }
  if (ids.size > 1) ambiguous = true;
  return { refs, ids, unresolved, ambiguous };
}
function resolveDocs(index, refs) {
  const docs = new Set();
  let ambiguous = false;
  for (const ref of refs) {
    const matches = index.get(text(ref));
    if (!matches?.size) continue;
    if (matches.size !== 1) { ambiguous = true; continue; }
    docs.add([...matches][0]);
  }
  if (docs.size > 1 || refs.length > 1) ambiguous = true;
  return { docs, ambiguous };
}
function addCompanySource(row, companyMap, aggregate) {
  if (!row || !aliases(row, COMPANY_FIELDS).length) return;
  const resolved = resolveCompanyRefs(row, companyMap);
  resolved.ids.forEach((id) => aggregate.ids.add(id));
  aggregate.hasReference = true;
  aggregate.unresolved ||= resolved.unresolved;
  aggregate.ambiguous ||= resolved.ambiguous;
}
function resolveStableCompanyScope(trip, indexes) {
  const aggregate = { ids: new Set(), hasReference: false, unresolved: false, ambiguous: false };
  addCompanySource(trip, indexes.companyMap, aggregate);

  const jobRefs = aliases(trip, JOB_FIELDS);
  const jobDocs = resolveDocs(indexes.jobIndex, jobRefs);
  aggregate.ambiguous ||= jobDocs.ambiguous;
  const linkedJobs = [...jobDocs.docs];
  linkedJobs.forEach((job) => addCompanySource(job, indexes.companyMap, aggregate));

  let contractRefs = aliases(trip, CONTRACT_FIELDS);
  if (!contractRefs.length && linkedJobs.length === 1) contractRefs = aliases(linkedJobs[0], CONTRACT_FIELDS);
  const contractDocs = resolveDocs(indexes.contractIndex, contractRefs);
  aggregate.ambiguous ||= contractDocs.ambiguous;
  [...contractDocs.docs].forEach((contract) => addCompanySource(contract, indexes.companyMap, aggregate));

  const tripAliases = unique([trip.id, ...TRIP_ID_FIELDS.map((field) => trip?.[field])]);
  const slotMatches = new Set();
  let slotAmbiguous = false;
  for (const alias of tripAliases) {
    const matches = indexes.slotIndex.get(alias);
    if (!matches?.size) continue;
    if (matches.size !== 1) { slotAmbiguous = true; continue; }
    slotMatches.add([...matches][0]);
  }
  if (slotMatches.size > 1 || slotMatches.size > 0 && slotAmbiguous) aggregate.ambiguous = true;
  for (const slot of slotMatches) {
    addCompanySource(slot, indexes.companyMap, aggregate);
    const slotJobRefs = aliases(slot, JOB_FIELDS);
    const slotJobs = resolveDocs(indexes.jobIndex, slotJobRefs);
    aggregate.ambiguous ||= slotJobs.ambiguous;
    [...slotJobs.docs].forEach((job) => addCompanySource(job, indexes.companyMap, aggregate));
    const slotContractRefs = aliases(slot, CONTRACT_FIELDS);
    const slotContracts = resolveDocs(indexes.contractIndex, slotContractRefs);
    aggregate.ambiguous ||= slotContracts.ambiguous;
    [...slotContracts.docs].forEach((contract) => addCompanySource(contract, indexes.companyMap, aggregate));
  }

  if (aggregate.ids.size > 1) aggregate.ambiguous = true;
  if (aggregate.ambiguous) return { status: "AMBIGUOUS", key: null };
  if (aggregate.ids.size === 1 && aggregate.unresolved) return { status: "PARTIAL", key: null };
  if (aggregate.ids.size === 1) return { status: "RESOLVED_UNIQUE", key: [...aggregate.ids][0] };
  if (aggregate.hasReference) return { status: "UNRESOLVED", key: null };
  return { status: "NO_COMPANY_REFERENCE", key: null };
}
function addNestedCount(root, path, key, amount = 1) {
  let current = root;
  for (const segment of path) current = current[segment] ||= {};
  increment(current, key, amount);
}

/** Build aggregate-only generation and structural identity diagnostics; no IDs or raw data leave memory. */
export function buildHistoricalGenerationDiagnostics(input) {
  const { trips = [], jobs = [], contracts = [], companies = [], slots = [], companyMap, jobIndex, contractIndex,
    schemaGenerationByPhysicalId = new Map(), eligibilityByPhysicalId = new Map(), directEvidenceByPhysicalId = new Map(),
    targetOperationLabel = "" } = input;
  const slotIndex = new Map();
  for (const slot of slots) {
    for (const alias of unique([slot.id, ...SLOT_ID_FIELDS.map((field) => slot?.[field])])) {
      const matches = slotIndex.get(alias) || new Set();
      matches.add(slot);
      slotIndex.set(alias, matches);
    }
  }
  const indexes = { companyMap, jobIndex, contractIndex, slotIndex };
  const histograms = {
    source: {}, automationSource: {}, schemaVersion: {}, schemaGeneration: {}, simpleAutomationVersion: {},
    gtoMoneySchemaVersion: {}, operationProjectionVersion: {}, creationMonth: {}, creationField: {},
    simpleReceiptCurrencyValue: {}, fieldPresence: {}, identityPresenceCombinations: {},
    operationIdentityPresenceCombinations: {}, simulatorPresenceCombinations: {},
  };
  const versionProfiles = {};
  const schemaProfiles = {};
  const generationGroups = new Map();
  const scopeGroups = new Map();
  const scopeStatuses = {};
  const monthProfiles = new Map();
  let exactTripSlotLinks = 0;
  let tripsWithJobReference = 0, exactJobFound = 0;
  let tripsWithContractReference = 0, exactContractFound = 0;
  let rowsWithAliasCurrency = 0, rowsWithExplicitReceiptCorroboration = 0, rowsWithUnverifiedSimpleAlias = 0;
  let companyIdAndEmpresaIdEqual = 0, companyIdAndEmpresaIdDifferent = 0;
  const expectedScreenshotScope = { physicalDocuments: 2144, eligibleDocuments: 2141 };

  for (const trip of trips) {
    const weight = 1;
    const key = trip.physicalDocumentId || `${trip.sourceCollection || "unknown"}/${trip.id || ""}`;
    const source = bucketSource(trip.source);
    const automationSource = bucketSource(trip.automationSource);
    const schemaVersion = bucketVersion(trip.schemaVersion);
    const schemaGeneration = schemaGenerationByPhysicalId.get(key) || "UNKNOWN";
    const simpleVersion = bucketVersion(trip.simpleAutomationVersion);
    const gtoVersion = bucketVersion(trip.gtoMoneySchemaVersion);
    const projectionVersion = bucketVersion(trip.operationProjectionVersion);
    const currency = bucketCurrency(trip.simpleReceiptCurrency);
    const created = creationPeriod(trip);
    const eligible = eligibilityByPhysicalId.get(key) === true;
    const direct = directEvidenceByPhysicalId.get(key) || {};
    const flags = {
      companyId: hasValue(trip, "companyId"),
      empresaId: hasValue(trip, "empresaId"),
      jobId: hasValue(trip, "jobId"),
      operationId: hasValue(trip, "operationId"),
      contractId: hasValue(trip, "contractId"),
      simulatorId: hasValue(trip, "simulatorId"),
      simulatorCode: hasValue(trip, "simulatorCode"),
      simpleReceiptCurrency: hasValue(trip, "simpleReceiptCurrency"),
      simpleAutomation: trip.simpleAutomation === true,
    };

    for (const [field, value] of Object.entries({ source, automationSource, schemaVersion, schemaGeneration, simpleAutomationVersion: simpleVersion,
      gtoMoneySchemaVersion: gtoVersion, operationProjectionVersion: projectionVersion, creationMonth: created.month, creationField: created.field,
      simpleReceiptCurrencyValue: currency })) increment(histograms[field], value, weight);
    for (const [field, value] of Object.entries(flags)) if (value) increment(histograms.fieldPresence, field, weight);
    increment(histograms.fieldPresence, "source", hasValue(trip, "source") ? weight : 0);
    increment(histograms.fieldPresence, "automationSource", hasValue(trip, "automationSource") ? weight : 0);
    increment(histograms.fieldPresence, "schemaVersion", hasValue(trip, "schemaVersion") ? weight : 0);
    increment(histograms.fieldPresence, "simpleAutomationVersion", hasValue(trip, "simpleAutomationVersion") ? weight : 0);

    const identityKey = `companyId=${+flags.companyId}|empresaId=${+flags.empresaId}`;
    increment(histograms.identityPresenceCombinations, identityKey, weight);
    const operationKey = `jobId=${+flags.jobId}|operationId=${+flags.operationId}|contractId=${+flags.contractId}`;
    increment(histograms.operationIdentityPresenceCombinations, operationKey, weight);
    const simulatorKey = `simulatorId=${+flags.simulatorId}|simulatorCode=${+flags.simulatorCode}`;
    increment(histograms.simulatorPresenceCombinations, simulatorKey, weight);
    if (flags.companyId && flags.empresaId) {
      const company = text(trip.companyId), empresa = text(trip.empresaId);
      if (company && empresa && company === empresa) companyIdAndEmpresaIdEqual++;
      else companyIdAndEmpresaIdDifferent++;
    }

    const profile = versionProfiles[simpleVersion] ||= {
      documentCount: 0, eligibleCount: 0, simpleReceiptCurrencyPresent: 0, simpleReceiptCurrencyValues: {},
      source: {}, automationSource: {}, receiptTextPresent: 0, aliasReceiptTokenCorroborated: 0, aliasUnverifiedBySourcePolicy: 0,
    };
    profile.documentCount++;
    if (eligible) profile.eligibleCount++;
    increment(profile.source, source);
    increment(profile.automationSource, automationSource);
    if (flags.simpleReceiptCurrency) {
      profile.simpleReceiptCurrencyPresent++;
      increment(profile.simpleReceiptCurrencyValues, currency);
      rowsWithAliasCurrency++;
      if (direct.simpleReceiptCurrencySupportedByReceipt === true) { profile.aliasReceiptTokenCorroborated++; rowsWithExplicitReceiptCorroboration++; }
      if (direct.simpleReceiptCurrencyUnverified === true) { profile.aliasUnverifiedBySourcePolicy++; rowsWithUnverifiedSimpleAlias++; }
    }
    if (direct.rawReceiptFieldPresent === true) profile.receiptTextPresent++;

    const schemaProfile = schemaProfiles[schemaGeneration] ||= { documentCount: 0, eligibleCount: 0, simpleReceiptCurrencyPresent: 0, simpleReceiptCurrencyValues: {}, writerVersions: {} };
    schemaProfile.documentCount++;
    if (eligible) schemaProfile.eligibleCount++;
    if (flags.simpleReceiptCurrency) {
      schemaProfile.simpleReceiptCurrencyPresent++;
      increment(schemaProfile.simpleReceiptCurrencyValues, currency);
      increment(schemaProfile.writerVersions, simpleVersion);
    }

    const signature = {
      source, automationSource, schemaGeneration, schemaVersion, gtoMoneySchemaVersion: gtoVersion,
      operationProjectionVersion: projectionVersion, simpleAutomationVersion: simpleVersion,
      companyId: flags.companyId, empresaId: flags.empresaId, jobId: flags.jobId,
      operationId: flags.operationId, contractId: flags.contractId, simulatorId: flags.simulatorId,
      simulatorCode: flags.simulatorCode, simpleReceiptCurrency: currency,
    };
    const signatureKey = JSON.stringify(signature);
    const generationGroup = generationGroups.get(signatureKey) || { ...signature, documentCount: 0, eligibleCount: 0, receiptTextPresent: 0, aliasReceiptTokenCorroborated: 0, firstCreationMonth: "", lastCreationMonth: "" };
    generationGroup.documentCount++;
    if (eligible) generationGroup.eligibleCount++;
    if (direct.rawReceiptFieldPresent === true) generationGroup.receiptTextPresent++;
    if (flags.simpleReceiptCurrency && direct.simpleReceiptCurrencySupportedByReceipt === true) generationGroup.aliasReceiptTokenCorroborated++;
    if (created.month !== "UNKNOWN") {
      if (!generationGroup.firstCreationMonth || created.month < generationGroup.firstCreationMonth) generationGroup.firstCreationMonth = created.month;
      if (!generationGroup.lastCreationMonth || created.month > generationGroup.lastCreationMonth) generationGroup.lastCreationMonth = created.month;
    }
    generationGroups.set(signatureKey, generationGroup);
    const monthKey = JSON.stringify({ schemaGeneration, simpleAutomationVersion: simpleVersion, month: created.month });
    const monthGroup = monthProfiles.get(monthKey) || { schemaGeneration, simpleAutomationVersion: simpleVersion, month: created.month, documentCount: 0, eligibleCount: 0 };
    monthGroup.documentCount++;
    if (eligible) monthGroup.eligibleCount++;
    monthProfiles.set(monthKey, monthGroup);

    const scope = resolveStableCompanyScope(trip, indexes);
    increment(scopeStatuses, scope.status);
    if (scope.status === "RESOLVED_UNIQUE") {
      const group = scopeGroups.get(scope.key) || { physicalTripDocuments: 0, eligibleTripDocuments: 0 };
      group.physicalTripDocuments++;
      if (eligible) group.eligibleTripDocuments++;
      scopeGroups.set(scope.key, group);
    }
    const jobAliases = aliases(trip, JOB_FIELDS);
    const contractAliases = aliases(trip, CONTRACT_FIELDS);
    if (jobAliases.length) {
      tripsWithJobReference++;
      if (jobAliases.length === 1 && jobIndex.get(jobAliases[0])?.size === 1) exactJobFound++;
    }
    if (contractAliases.length) {
      tripsWithContractReference++;
      if (contractAliases.length === 1 && contractIndex.get(contractAliases[0])?.size === 1) exactContractFound++;
    }
    const tripIds = unique([trip.id, ...TRIP_ID_FIELDS.map((field) => trip?.[field])]);
    if (tripIds.some((alias) => slotIndex.get(alias)?.size === 1)) exactTripSlotLinks++;
  }

  const matchingScopes = [...scopeGroups.values()].filter((group) => group.physicalTripDocuments === expectedScreenshotScope.physicalDocuments && group.eligibleTripDocuments === expectedScreenshotScope.eligibleDocuments);
  const largestScopes = [...scopeGroups.values()]
    .sort((a, b) => b.physicalTripDocuments - a.physicalTripDocuments || b.eligibleTripDocuments - a.eligibleTripDocuments)
    .slice(0, 10)
    .map((group, index) => ({ rank: index + 1, ...group, ineligibleTripDocuments: group.physicalTripDocuments - group.eligibleTripDocuments }));
  const label = text(targetOperationLabel).toUpperCase();
  const exactTripAliasMatches = label ? trips.filter((trip) => [...JOB_FIELDS, ...CONTRACT_FIELDS].some((field) => text(trip?.[field]).toUpperCase() === label)).length : 0;
  const exactSlotMatches = label ? slots.filter((slot) => text(slot.id).toUpperCase() === label || [...JOB_FIELDS, ...CONTRACT_FIELDS, "name", "nome", "code", "codigo", "number", "operationCode", "jobCode", "contractCode", "operationName", "contractName"].some((field) => text(slot?.[field]).toUpperCase() === label)).length : 0;
  const orderedGroups = [...generationGroups.values()].sort((a, b) => b.documentCount - a.documentCount || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    scope: "aggregate-only; physical trip documents; exact ID/document joins; company display names were not queried or used",
    distributions: histograms,
    bySimpleAutomationVersion: versionProfiles,
    bySchemaGeneration: schemaProfiles,
    generationCombinations: orderedGroups,
    generationCombinationsTruncated: false,
    schemaWriterCreationPeriods: [...monthProfiles.values()].sort((a, b) => a.month.localeCompare(b.month) || a.schemaGeneration.localeCompare(b.schemaGeneration) || a.simpleAutomationVersion.localeCompare(b.simpleAutomationVersion)),
    simpleReceiptCurrencyProvenance: {
      documentsWithAlias: rowsWithAliasCurrency,
      aliasWithExplicitReceiptTokenCorroboration: rowsWithExplicitReceiptCorroboration,
      aliasUnverifiedByCurrentSourcePolicy: rowsWithUnverifiedSimpleAlias,
      note: "Corroboration means an explicit supported currency token in persisted receipt text agrees with the alias; the token alone does not establish operation/company scope.",
    },
    companyScopeByExactIdentity: {
      frotasCompanyDocumentsRead: companies.length,
      resolvedUniqueCompanyScopes: scopeGroups.size,
      tripDocumentsByResolutionStatus: scopeStatuses,
      companyIdAndEmpresaIdBothPresentAndEqual: companyIdAndEmpresaIdEqual,
      companyIdAndEmpresaIdBothPresentButDifferentOrIncomplete: companyIdAndEmpresaIdDifferent,
      largestResolvedScopes,
      screenshotCardinality: {
        expectedPhysicalDocuments: expectedScreenshotScope.physicalDocuments,
        expectedEligibleDocuments: expectedScreenshotScope.eligibleDocuments,
        exactScopeMatchesByCardinality: matchingScopes.length,
        uniqueExactMatch: matchingScopes.length === 1,
        rowsWereJoinedByCompanyName: false,
      },
      method: "Join trip, unique linked job, unique linked contract, unique exact trip_operation_slots entry, and frotas alias registry by exact IDs; reject conflicting/partial company mappings. Names are neither read nor join keys.",
    },
    structuralLinkage: {
      tripsWithJobReference, exactJobDocumentFound: exactJobFound,
      tripsWithContractReference, exactContractDocumentFound: exactContractFound,
      tripOperationSlotDocuments: slots.length,
      tripsWithExactTripIdentitySlotLink: exactTripSlotLinks,
      tripOperationSlotsWithJobId: slots.filter((slot) => presence(slot, JOB_FIELDS)).length,
      tripOperationSlotsWithContractId: slots.filter((slot) => presence(slot, CONTRACT_FIELDS)).length,
      tripOperationSlotsWithCompanyId: slots.filter((slot) => presence(slot, COMPANY_FIELDS)).length,
      targetOperationLabel: label || null,
      exactTripAliasMatchesToTarget: exactTripAliasMatches,
      exactTripOperationSlotLabelOrIdMatches: exactSlotMatches,
    },
    integrity: { outputContainsDocumentIds: false, outputContainsCompanyNames: false, outputContainsDriverIds: false, outputContainsRoutes: false, outputContainsReceiptText: false },
  };
}
