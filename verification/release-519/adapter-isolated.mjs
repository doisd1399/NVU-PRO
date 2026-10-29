// src/lib/firebase.ts
var auth = { currentUser: null };
var db = {};
var functions = {};

// src/lib/receiptTransportPolicy.ts
function hasConfirmedReceiptTransport(value, emulatorProjectId) {
  if (/^https:\/\//i.test(value)) return true;
  if (emulatorProjectId !== "demo-nvu-v36-4-staging") return false;
  try {
    const url = new URL(value);
    if (url.origin !== "http://127.0.0.1:9199" || url.username || url.password) return false;
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    return Boolean(match && [emulatorProjectId + ".appspot.com", emulatorProjectId + ".firebasestorage.app"].includes(decodeURIComponent(match[1])));
  } catch {
    return false;
  }
}
function isConfirmedReceiptUploadUrl(value) {
  const env = import.meta.env || {};
  const isolatedDemo = env.VITE_USE_FIREBASE_EMULATORS === "true" && env.VITE_FIREBASE_PROJECT_ID === "demo-nvu-v36-4-staging";
  return hasConfirmedReceiptTransport(value, isolatedDemo ? "demo-nvu-v36-4-staging" : void 0);
}

// fake:firebase/firestore
var doc = (_db, _collection, id) => ({ id });
var getDocFromServer = (ref) => globalThis.__qa519.read(ref);
var runTransaction = () => {
  throw Error("unexpected transaction");
};
var serverTimestamp = () => "server";

// src/lib/offlineReceiptStore.ts
var getOfflineReceipt = () => {
  throw Error("unexpected receipt read");
};
var markOfflineReceiptUploaded = () => {
};

// src/services/uploadService.ts
var uploadService = { uploadImage: () => {
  throw Error("unexpected upload");
} };

// fake:firebase/functions
var httpsCallable = () => () => {
  throw Error("unexpected callable");
};

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

// src/services/sync/CanonicalTripRegistrationRequest.ts
var registrationFields = /* @__PURE__ */ new Set([
  "tripId",
  "canonicalTripId",
  "deterministicTripId",
  "clientRequestId",
  "idempotencyKey",
  "source",
  "driverId",
  "motoristaId",
  "companyId",
  "empresaId",
  "contractId",
  "contratoId",
  "currency",
  "moeda",
  "moneyCurrency",
  "receiptCurrency",
  "jobId",
  "operationId",
  "trabalhoId",
  "origem",
  "origin",
  "destino",
  "destination",
  "comprovanteUrl",
  "comprovanteTituloOriginal",
  "imageHash",
  "receiptText",
  "simpleAutomation",
  "simpleAutomationVersion",
  "simpleReceiptCurrency",
  "simpleReceiptSourceField",
  "simpleReceiptResultScreenConfirmed",
  "simpleReceiptBonusEvidence",
  "simpleReceiptConfidence",
  "simpleReceiptCapturedAt",
  "simpleReceiptCaptureAttemptId",
  "simpleReceiptCaptureContextEpoch",
  "simpleReceiptHash",
  "simpleDuplicateGuardKey",
  "gtoEntryMode",
  "gtoReceiptAnalyzed",
  "gtoRewardedAdDetected",
  "gtoReceiptValidationMode",
  "gtoReceiptManualConfirmation",
  "gtoReceiptEvidence",
  "valorDetectadoAutomaticamente",
  "valorDeteccaoMetodo",
  "simulatorKey",
  "simulatorId",
  "simulatorCode",
  "simulatorName",
  "simuladorNome",
  "simuladorCodigo",
  "veiculoId",
  "veiculoNome",
  "veiculoPlaca",
  "reboqueId",
  "reboqueNome",
  "registroAutomatico",
  "motoristaNome",
  "empresaNome",
  "contratoNumero",
  "contratoDescricao",
  "distanciaPercorrida",
  "automationSource",
  "nativeSubmission",
  "nativeSubmissionVersion",
  "createdAtClient",
  "completedAtClient",
  "createdAtLocal",
  "completedAtLocal"
]);
function buildCanonicalTripRegistrationRequest(trip, receiptUrl) {
  const amount = Number(trip.valor ?? trip.earnings);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 1e9) {
    throw new Error("CANONICAL_TRIP_AMOUNT_INVALID");
  }
  if (trip.valorCents != null && Number(trip.valorCents) !== cents) {
    throw new Error("CANONICAL_TRIP_AMOUNT_MISMATCH");
  }
  const payload = Object.fromEntries(Object.entries(trip).filter(([key, value]) => value !== void 0 && registrationFields.has(key)));
  const money = resolveTripCurrency(trip);
  const explicitCurrency = money.currencyStatus === "known" && money.currency && money.currencySource !== "SIMULATOR_REGISTRY";
  if (trip.simpleAutomation === true) {
    for (const field of ["currency", "moeda", "moneyCurrency", "receiptCurrency", "simpleReceiptCurrency"]) delete payload[field];
    if (explicitCurrency) payload.simpleReceiptCurrency = money.currency;
  } else if (explicitCurrency) {
    payload.currency = money.currency;
  }
  if (trip.simpleAutomation !== true && payload.moeda !== void 0) {
    if (money.currencyStatus !== "conflict") {
      if (!payload.currency) payload.currency = payload.moeda;
      delete payload.moeda;
    }
  }
  payload.valor = cents / 100;
  payload.valorCents = cents;
  if (receiptUrl) payload.comprovanteUrl = receiptUrl;
  else delete payload.comprovanteUrl;
  return { trip: payload };
}

// src/lib/tripSyncDeadline.ts
async function tripSyncDeadline(work, milliseconds, stage) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`TRIP_SYNC_TIMEOUT:${stage}`), {
        code: "functions/deadline-exceeded",
        tripSyncStage: stage
      })), milliseconds);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// src/services/sync/receiptUploadFlight.ts
var flights = /* @__PURE__ */ new Map();
function receiptUploadFlight(key, work) {
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = Promise.resolve().then(work);
  flights.set(key, flight);
  const cleanup = () => {
    if (flights.get(key) === flight) flights.delete(key);
  };
  void flight.then(cleanup, cleanup);
  return flight;
}

// src/services/sync/FirebaseTripSyncAdapter.ts
var readText = (value) => String(value ?? "").trim();
var FirebaseTripSyncAdapter = class {
  constructor(dependencies = {}) {
    this.serverReadTimeoutMs = dependencies.serverReadTimeoutMs ?? 1e4;
    this.firestore = dependencies.firestore || db;
    this.getCurrentUser = dependencies.getCurrentUser || (() => auth.currentUser);
    this.registerCanonicalTrip = dependencies.registerCanonicalTrip || (async (data) => {
      const register = httpsCallable(functions, "registerCanonicalSimpleTrip", { timeout: 2e4 });
      let result;
      try {
        result = await register(data);
      } catch (error) {
        if (String(error?.code || "") !== "functions/unauthenticated" || !auth.currentUser) throw error;
        const owner = auth.currentUser.uid;
        await auth.currentUser.getIdToken(true);
        if (auth.currentUser?.uid !== owner) throw error;
        result = await register(data);
      }
      return { data: result.data };
    });
    this.loadOfflineReceipt = dependencies.loadOfflineReceipt || getOfflineReceipt;
    this.markReceiptUploaded = dependencies.markReceiptUploaded || markOfflineReceiptUploaded;
    this.uploadReceipt = dependencies.uploadReceipt || (async (input) => {
      const file = new File([input.blob], input.fileName, { type: input.contentType });
      return uploadService.uploadImage({
        file,
        companyId: input.companyId,
        userId: input.userId,
        folder: "receipts",
        storageScope: "trip-receipt",
        compressionMaxSizeMB: 1,
        maxWidthOrHeight: 1920,
        maxOutputBytes: 18e5
      });
    });
    this.reconcileOperation = dependencies.reconcileOperation || (async (data) => {
      const reconcile = httpsCallable(functions, "reconcileOperationTrips", { timeout: 2e4 });
      const result = await reconcile(data);
      return result.data;
    });
  }
  /** A paused send resumes only after the server confirms current account and fleet access. */
  async authorizeRecovery(trip) {
    const uid = this.getCurrentUser()?.uid;
    if (!uid || uid !== readText(trip.driverId) || !readText(trip.companyId)) return false;
    const check = httpsCallable(functions, "ensureCompanyAccess", { timeout: 2e4 });
    const result = await check({ companyId: trip.companyId });
    return this.getCurrentUser()?.uid === uid && result.data?.active === true;
  }
  async update(trip, patch, baseVersion, editId, actorUserId, beforeEdit) {
    const tripId = readText(trip.physicalDocumentId || trip.canonicalTripId || trip.tripId);
    if (!tripId || !editId || !actorUserId || this.getCurrentUser()?.uid !== actorUserId) {
      throw new Error("CANONICAL_TRIP_EDIT_IDENTITY_REQUIRED");
    }
    const keys = Object.keys(patch);
    const allowed = /* @__PURE__ */ new Set(["origem", "destino", "valor", "valorCents", "valorEditadoNoPainelSenior", "valorEditadoPor", "valorEditadoEm"]);
    if (!keys.length || keys.some((key) => !allowed.has(key))) throw new Error("CANONICAL_TRIP_EDIT_FIELDS_INVALID");
    const changingValue = keys.some((key) => key !== "origem" && key !== "destino");
    if (changingValue && (!keys.includes("valor") || !keys.includes("valorCents") || Number(patch.valorCents) !== Math.round(Number(patch.valor) * 100) || Number(patch.valorCents) <= 0)) throw new Error("CANONICAL_TRIP_EDIT_VALUE_INVALID");
    const tripRef = doc(this.firestore, "historico_viagens", tripId);
    await runTransaction(this.firestore, async (transaction) => {
      const snapshot = await transaction.get(tripRef);
      if (!snapshot.exists()) throw new Error("CANONICAL_TRIP_NOT_FOUND");
      const current = snapshot.data();
      if (current.deleted === true || current.status === "DELETED") {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      if (readText(current.driverId || current.motoristaId) !== readText(trip.driverId) || readText(current.companyId || current.empresaId) !== readText(trip.companyId)) {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      if (current.lastEditId === editId) return;
      if (Math.max(1, Number(current.syncVersion || 1)) !== baseVersion) {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      if (beforeEdit && ("origem" in patch && readText(current.origem) !== readText(beforeEdit.origem) || "destino" in patch && readText(current.destino) !== readText(beforeEdit.destino) || changingValue && readText(current.valor) !== readText(beforeEdit.valor))) {
        throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), { code: "CANONICAL_TRIP_CONFLICT", serverTrip: { id: tripId, ...current } });
      }
      const serverPatch = {
        syncVersion: baseVersion + 1,
        lastEditId: editId,
        editedBy: actorUserId,
        updatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
        clientUpdatedAt: readText(trip.clientUpdatedAt) || (/* @__PURE__ */ new Date()).toISOString()
      };
      if ("origem" in patch) serverPatch.origem = readText(patch.origem);
      if ("destino" in patch) serverPatch.destino = readText(patch.destino);
      if (changingValue) {
        serverPatch.valor = Number(patch.valor);
        serverPatch.valorCents = Number(patch.valorCents);
        serverPatch.valorEditadoNoPainelSenior = true;
        serverPatch.valorEditadoPor = actorUserId;
        serverPatch.valorEditadoEm = serverTimestamp();
      }
      transaction.update(tripRef, serverPatch);
    });
    const confirmed = await tripSyncDeadline(getDocFromServer(tripRef), this.serverReadTimeoutMs, "EDIT_SERVER_READ");
    if (!confirmed.exists() || confirmed.data().lastEditId !== editId) throw new Error("SERVER_TRIP_EDIT_ACK_INVALID");
    return { confirmed: true, tripId, data: { id: tripId, ...confirmed.data() } };
  }
  prepareReceipt(receiptKey, driverId, companyId) {
    return receiptUploadFlight(JSON.stringify([driverId, companyId, receiptKey]), async () => {
      if (this.getCurrentUser()?.uid !== driverId) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
      const receipt = await this.loadOfflineReceipt(receiptKey);
      if (!receipt || receipt.userId !== driverId || receipt.companyId !== companyId)
        throw new Error("OFFLINE_RECEIPT_OWNER_OR_DATA_MISMATCH");
      const url = receipt.uploadedUrl || await this.uploadReceipt({
        blob: receipt.blob,
        fileName: receipt.fileName,
        contentType: receipt.contentType,
        companyId,
        userId: driverId
      });
      if (!isConfirmedReceiptUploadUrl(url)) throw new Error("OFFLINE_RECEIPT_UPLOAD_NOT_CONFIRMED");
      if (this.getCurrentUser()?.uid !== driverId) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
      if (!receipt.uploadedUrl) await this.markReceiptUploaded(receiptKey, url);
      return url;
    });
  }
  async push(trip) {
    let stage = "LOCAL_VALIDATION";
    let registrationAccepted = false;
    try {
      const tripId = readText(trip.canonicalTripId || trip.tripId || trip.clientRequestId || trip.idempotencyKey);
      const suppliedTripId = readText(trip.tripId);
      const driverId = readText(trip.driverId || trip.motoristaId);
      const companyId = readText(trip.companyId || trip.empresaId);
      const jobId = readText(trip.jobId);
      const idempotencyKey = readText(trip.idempotencyKey || trip.clientRequestId);
      const user = this.getCurrentUser();
      if (!tripId || !driverId || !companyId || !jobId || !idempotencyKey) {
        throw new Error("CANONICAL_TRIP_REQUIRED_FIELDS_MISSING");
      }
      if (suppliedTripId && suppliedTripId !== tripId) throw new Error("CANONICAL_TRIP_IDENTITY_MISMATCH");
      if (!user?.uid || user.uid !== driverId) {
        throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
      }
      if (trip.gtoEntryMode === "print" && (!Number.isFinite(Number(trip.valor)) || Number(trip.valor) <= 0)) {
        throw new Error("GTO_PRINT_AMOUNT_INVALID");
      }
      const tripRef = doc(this.firestore, "historico_viagens", tripId);
      let receiptUrl = readText(trip.comprovanteUrl);
      const receiptKey = readText(trip.offlineReceiptKey);
      if (receiptKey) {
        stage = "RECEIPT_UPLOAD";
        receiptUrl = await this.prepareReceipt(receiptKey, driverId, companyId);
      }
      if (trip.imageHash && !isConfirmedReceiptUploadUrl(receiptUrl)) {
        throw new Error("TRIP_RECEIPT_URL_NOT_CONFIRMED");
      }
      if (this.getCurrentUser()?.uid !== driverId) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
      stage = "CALLABLE_REGISTRATION";
      const request = buildCanonicalTripRegistrationRequest(trip, receiptUrl);
      let callableResult;
      try {
        callableResult = await this.registerCanonicalTrip(request);
      } catch (error) {
        const reason = String(error?.message || "");
        const code = String(error?.code || "");
        if (!code.includes("failed-precondition") || !/OPERATION_RECONCILIATION_REQUIRED|reserva (?:operacional )?sem hist[oó]rico|reconcilie a opera[cç][aã]o/i.test(reason)) throw error;
        stage = "OPERATION_RECONCILIATION";
        await tripSyncDeadline(this.reconcileOperation({ jobId }), 2e4, stage);
        if (this.getCurrentUser()?.uid !== driverId) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
        stage = "CALLABLE_REGISTRATION";
        callableResult = await this.registerCanonicalTrip(request);
      }
      stage = "CALLABLE_ACK";
      const payload = callableResult.data;
      const acknowledgedId = readText(payload.tripId);
      const receiptDuplicate = payload.duplicate === true && payload.receiptEventDuplicate === true;
      if (payload.registered !== true || !acknowledgedId || acknowledgedId !== tripId && !receiptDuplicate) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_INVALID");
      }
      registrationAccepted = true;
      stage = "SERVER_READ";
      const inline = payload.canonicalAckVersion === 1 && payload.confirmedTrip && typeof payload.confirmedTrip === "object" && !Array.isArray(payload.confirmedTrip) ? payload.confirmedTrip : null;
      let saved;
      if (inline) saved = inline;
      else {
        const confirmed = await tripSyncDeadline(getDocFromServer(acknowledgedId === tripId ? tripRef : doc(this.firestore, "historico_viagens", acknowledgedId)), this.serverReadTimeoutMs, "SERVER_READ");
        if (!confirmed.exists()) throw new Error("SERVER_CANONICAL_TRIP_ACK_MISSING");
        saved = confirmed.data();
      }
      stage = "SERVER_ACK";
      if (!saved.serverValidatedAt || inline && (readText(saved.id) !== acknowledgedId || readText(saved.tripId) !== acknowledgedId || readText(saved.canonicalTripId) !== acknowledgedId))
        throw new Error("SERVER_CANONICAL_TRIP_ACK_SCOPE_MISMATCH");
      if (inline && (readText(saved.origem) !== readText(trip.origem) || readText(saved.destino) !== readText(trip.destino) || trip.imageHash && readText(saved.imageHash) !== readText(trip.imageHash)))
        throw new Error("SERVER_CANONICAL_TRIP_ACK_SCOPE_MISMATCH");
      if (saved.deleted === true || saved.status === "DELETED" || readText(saved.driverId || saved.motoristaId) !== driverId || readText(saved.companyId || saved.empresaId) !== companyId || readText(saved.jobId) !== jobId || readText(saved.contractId || saved.contratoId) !== readText(trip.contractId || trip.contratoId) || Number(saved.valorCents ?? Math.round(Number(saved.valor) * 100)) !== Number(trip.valorCents ?? Math.round(Number(trip.valor) * 100))) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_SCOPE_MISMATCH");
      }
      if (acknowledgedId !== tripId && (readText(saved.driverId || saved.motoristaId) !== driverId || readText(saved.companyId || saved.empresaId) !== companyId || readText(saved.jobId) !== jobId || readText(saved.contractId || saved.contratoId) !== readText(trip.contractId || trip.contratoId) || readText(saved.origem) !== readText(trip.origem) || readText(saved.destino) !== readText(trip.destino) || Number(saved.valorCents) !== Number(trip.valorCents))) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_SCOPE_MISMATCH");
      }
      if (acknowledgedId !== tripId && (!readText(saved.receiptEventKey) || readText(saved.simpleReceiptCaptureContextEpoch) !== readText(trip.simpleReceiptCaptureContextEpoch) || Number(saved.simpleReceiptCapturedAt) !== Number(trip.simpleReceiptCapturedAt))) {
        throw new Error("SERVER_CANONICAL_TRIP_ACK_CAPTURE_MISMATCH");
      }
      return { confirmed: true, tripId: acknowledgedId, data: { ...saved, id: acknowledgedId } };
    } catch (error) {
      if (error && typeof error === "object" && /SERVER_CANONICAL_TRIP_ACK_(?:SCOPE|CAPTURE)_MISMATCH/.test(String(error.message))) {
        Object.assign(error, { code: "CANONICAL_TRIP_CONFLICT", details: { retryable: false, reasonCode: "ACK_EVIDENCE_CONFLICT", stage } });
      }
      try {
        if (error && typeof error === "object") Object.assign(error, {
          tripSyncStage: stage,
          tripRegistrationAccepted: registrationAccepted
        });
      } catch {
      }
      throw error;
    }
  }
  async delete(trip) {
    const tripId = readText(trip.physicalDocumentId || trip.canonicalTripId || trip.tripId || trip.clientRequestId || trip.idempotencyKey);
    const user = this.getCurrentUser();
    if (!tripId || !user?.uid) throw new Error("CANONICAL_TRIP_DELETE_IDENTITY_REQUIRED");
    const tripRef = doc(this.firestore, "historico_viagens", tripId);
    const slotRef = doc(this.firestore, "trip_operation_slots", tripId);
    await runTransaction(this.firestore, async (transaction) => {
      const existing = await transaction.get(tripRef);
      if (!existing.exists()) return;
      const current = existing.data();
      const ownerId = readText(current.driverId || current.motoristaId || current.criadoPor);
      const jobId2 = readText(current.jobId);
      const jobRef = jobId2 ? doc(this.firestore, "trabalhos", jobId2) : null;
      const slot = await transaction.get(slotRef);
      const job = jobRef ? await transaction.get(jobRef) : null;
      const alreadyDeleted = current.deleted === true && current.status === "DELETED" && Boolean(current.deletedAt);
      const slotExists = slot.exists();
      const activeSlot = slotExists && slot.data().deleted !== true;
      if (slotExists && slot.data().deleted === true && !alreadyDeleted) {
        throw new Error("CANONICAL_TRIP_OPERATION_SLOT_INCONSISTENT");
      }
      const jobData = job?.exists() ? job.data() : null;
      const operationBindingValid = Boolean(jobRef && jobData) && readText(current.jobId) === jobId2 && readText(jobData?.driverId || jobData?.motoristaId) === ownerId && readText(current.companyId || current.empresaId) === readText(jobData?.companyId || jobData?.empresaId) && readText(current.contractId || current.contratoId) === readText(jobData?.contractId || jobData?.contratoId);
      if (activeSlot && (!jobData || !jobRef)) {
        throw new Error("CANONICAL_TRIP_OPERATION_PROJECTION_MISSING");
      }
      if (jobRef && jobData && !operationBindingValid) {
        throw new Error("CANONICAL_TRIP_OPERATION_SCOPE_MISMATCH");
      }
      if (activeSlot && jobData && jobRef) {
        if (readText(slot.data().jobId) !== jobId2 || readText(slot.data().driverId) !== ownerId || readText(slot.data().tripId) !== tripId) {
          throw new Error("CANONICAL_TRIP_OPERATION_SCOPE_MISMATCH");
        }
      }
      if (!alreadyDeleted) {
        transaction.update(tripRef, {
          deleted: true,
          status: "DELETED",
          deletedAt: serverTimestamp(),
          deletedBy: user.uid,
          updatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
          clientUpdatedAt: readText(trip.clientUpdatedAt) || (/* @__PURE__ */ new Date()).toISOString(),
          syncVersion: Math.max(1, Number(trip.syncVersion || current.syncVersion || 0))
        });
      }
      if (activeSlot && job?.exists() && jobRef) {
        transaction.update(slotRef, { deleted: true, deletedAt: serverTimestamp() });
      }
    });
    const jobId = readText(trip.jobId);
    if (jobId) {
      try {
        await this.reconcileOperation({ jobId });
      } catch {
      }
    }
    const confirmed = await getDocFromServer(tripRef);
    if (!confirmed.exists()) {
      return {
        confirmed: true,
        tripId,
        data: { deleted: true, status: "DELETED", deletedAt: trip.deletedAt || (/* @__PURE__ */ new Date()).toISOString() }
      };
    }
    const data = { ...confirmed.data(), id: confirmed.id, physicalDocumentId: confirmed.id };
    if (data.deleted !== true || data.status !== "DELETED" || !data.deletedAt) {
      throw new Error("SERVER_TRIP_DELETE_ACK_INVALID");
    }
    return { confirmed: true, tripId, data };
  }
};
var firebaseTripSyncAdapter = new FirebaseTripSyncAdapter();
export {
  FirebaseTripSyncAdapter
};
