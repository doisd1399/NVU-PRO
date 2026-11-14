type Data = Record<string, any>;

export type SlotClassification =
  | "SLOT_EXPLICIT"
  | "SLOT_DERIVED_FROM_HISTORICAL_CONTRACT"
  | "SLOT_DERIVED_FROM_UNIQUE_SEQUENCE"
  | "SLOT_ORDER_PROVEN"
  | "SLOT_UNRESOLVED"
  | "SLOT_CONFLICT";
export type DuplicateClassification = "EXACT_DUPLICATE" | "PROBABLE_DUPLICATE" | "DISTINCT_TRIP" | "UNRESOLVED";
export type RequiredTripsClassification = "REQUIRED_TRIPS_PROVEN" | "REQUIRED_TRIPS_MISSING" | "REQUIRED_TRIPS_CONFLICT" | "REQUIRED_TRIPS_INVALID";
export type ReconstructionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNRESOLVED";

export type ReconstructedTrip = {
  tripId: string;
  duplicateClassification: DuplicateClassification;
  slotClassification: SlotClassification;
  slot: number | null;
  excludedFromProgress: boolean;
  reasons: string[];
};

export type OperationHistoricalReconstruction = {
  operationId: string;
  requiredTrips: number | null;
  requiredTripsClassification: RequiredTripsClassification;
  provenTrips: number;
  deterministicSlots: number;
  unresolvedSlots: number;
  duplicateCandidates: number;
  exactDuplicates: number;
  probableDuplicates: number;
  unresolvedDuplicates: number;
  terminalState: "INCOMPLETE" | "COMPLETED_CANDIDATE" | "CRITICAL_OVERFLOW" | "UNKNOWN";
  projectedProgress: number;
  reconstructionConfidence: ReconstructionConfidence;
  blockingReasons: string[];
  trips: ReconstructedTrip[];
  gates: { countSafe: boolean; slotSafe: boolean; terminalSafe: boolean; migrationSafe: boolean };
  explicitSlots: number;
  derivedSlots: number;
};

const text = (v: unknown) => String(v ?? "").trim();
const field = (row: Data, ...keys: string[]) => keys.map((key) => text(row[key])).find(Boolean) || "";
const identity = (row: Data) => field(row, "canonicalTripId", "tripId", "idempotencyKey", "gtoTripSessionId", "__docId", "id");
const physicalKey = (row: Data) => field(row, "__docId", "documentId", "id");
const opId = (row: Data) => field(row, "operationId", "jobId", "trabalhoId");
const integer = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const timestamp = (v: unknown) => { if (typeof v === "number" && Number.isFinite(v)) return v; const parsed = Date.parse(String(v || "")); return Number.isFinite(parsed) ? parsed : 0; };

function requiredTripsOf(operation: Data): { value: number | null; classification: RequiredTripsClassification; reason?: string } {
  const values = [operation.totalDeliveries, operation.requiredTrips].filter((v) => v !== undefined && v !== null && text(v) !== "");
  if (!values.length) return { value: null, classification: "REQUIRED_TRIPS_MISSING", reason: "no totalDeliveries/requiredTrips field" };
  const parsed = values.map(Number);
  if (parsed.some((n) => !Number.isInteger(n) || n <= 0)) return { value: null, classification: "REQUIRED_TRIPS_INVALID", reason: "requiredTrips must be a positive integer" };
  if (new Set(parsed).size > 1) return { value: null, classification: "REQUIRED_TRIPS_CONFLICT", reason: "totalDeliveries and requiredTrips disagree" };
  return { value: parsed[0], classification: "REQUIRED_TRIPS_PROVEN" };
}

function businessSignature(row: Data): string {
  return JSON.stringify([
    opId(row), field(row, "driverId", "motoristaId", "userId", "criadoPor"),
    field(row, "companyId", "empresaId"), field(row, "contractId", "contratoId"),
    field(row, "origem", "origin"), field(row, "destino", "destination"),
    text(row.valor ?? row.value), text(row.simulatorId ?? row.simuladorId),
    timestamp(row.createdAt), timestamp(row.completedAt), timestamp(row.uploadedAt),
  ]);
}

function duplicateClasses(trips: Data[]): Map<string, DuplicateClassification> {
  const groups = new Map<string, Data[]>();
  trips.forEach((trip) => { const key = field(trip, "canonicalTripId", "idempotencyKey", "gtoTripSessionId", "tripId"); if (key) groups.set(key, [...(groups.get(key) || []), trip]); });
  const result = new Map<string, DuplicateClassification>();
  trips.forEach((trip) => result.set(physicalKey(trip), "DISTINCT_TRIP"));
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const signatures = new Set(group.map(businessSignature));
    const classification: DuplicateClassification = signatures.size === 1 ? "EXACT_DUPLICATE" : "UNRESOLVED";
    group.forEach((trip, index) => result.set(physicalKey(trip), index === 0 && classification === "EXACT_DUPLICATE" ? "DISTINCT_TRIP" : classification));
  }
  return result;
}

function historicalSequence(trip: Data): number | null {
  // These fields are accepted only when the historical writer explicitly
  // persisted them. The known GTO bundles do not persist any of them.
  for (const key of ["tripNumber", "sequence", "tripIndex", "progressAfter", "completedTrips"]) {
    const n = integer(trip[key]);
    if (n) return n;
  }
  return null;
}

function resolveSlot(trip: Data, claim: Data | undefined, used: Map<number, string>, requiredTrips: number | null): { classification: SlotClassification; slot: number | null; reason?: string } {
  const rowSlot = integer(trip.operationSlot);
  const claimSlot = claim && integer(claim.operationSlot);
  if (rowSlot && claimSlot && rowSlot !== claimSlot) return { classification: "SLOT_CONFLICT", slot: null, reason: "trip operationSlot and slot claim disagree" };
  const explicit = rowSlot || claimSlot;
  if (explicit) {
    if (requiredTrips && explicit > requiredTrips) return { classification: "SLOT_CONFLICT", slot: explicit, reason: "explicit slot exceeds requiredTrips" };
    const owner = used.get(explicit);
    if (owner && owner !== identity(trip)) return { classification: "SLOT_CONFLICT", slot: explicit, reason: "two distinct trips claim the same slot" };
    used.set(explicit, identity(trip));
    return { classification: "SLOT_EXPLICIT", slot: explicit };
  }
  const sequence = historicalSequence(trip);
  if (sequence) {
    if (requiredTrips && sequence > requiredTrips) return { classification: "SLOT_CONFLICT", slot: sequence, reason: "historical sequence exceeds requiredTrips" };
    const owner = used.get(sequence);
    if (owner && owner !== identity(trip)) return { classification: "SLOT_CONFLICT", slot: sequence, reason: "historical sequence collision" };
    used.set(sequence, identity(trip));
    return { classification: "SLOT_DERIVED_FROM_HISTORICAL_CONTRACT", slot: sequence };
  }
  return { classification: "SLOT_UNRESOLVED", slot: null, reason: "known historical writers did not persist order/sequence and no explicit slot exists" };
}

export function reconstructOperationHistoricalState(input: {
  operation: Data;
  canonicalTrips: readonly Data[];
  legacyProvenTrips: readonly Data[];
  slotClaims?: readonly Data[];
  allScopedTrips?: readonly Data[];
  classificationByTripId?: ReadonlyMap<string, string>;
}): OperationHistoricalReconstruction {
  const operationId = opId(input.operation) || text(input.operation.id);
  const required = requiredTripsOf(input.operation);
  const all = [...input.canonicalTrips, ...input.legacyProvenTrips];
  const candidates = all.slice();
  const duplicateMap = duplicateClasses(all);
  const claimsByIdentity = new Map<string, Data>();
  for (const claim of input.slotClaims || []) { const key = identity(claim); if (key) claimsByIdentity.set(key, claim); }
  const usedSlots = new Map<number, string>();
  const reconstructed: ReconstructedTrip[] = [];
  let exactDuplicates = 0; let probableDuplicates = 0; let unresolvedDuplicates = 0;
  let deterministicSlots = 0; let unresolvedSlots = 0; let explicitSlots = 0; let derivedSlots = 0;
  const blockingReasons = new Set<string>();
  for (const trip of candidates) {
    const id = identity(trip);
    const duplicateClassification = duplicateMap.get(physicalKey(trip)) || "DISTINCT_TRIP";
    if (duplicateClassification === "EXACT_DUPLICATE") exactDuplicates += 1;
    if (duplicateClassification === "PROBABLE_DUPLICATE") probableDuplicates += 1;
    if (duplicateClassification === "UNRESOLVED") unresolvedDuplicates += 1;
    const excludedFromProgress = duplicateClassification === "EXACT_DUPLICATE";
    const slot = excludedFromProgress ? { classification: "SLOT_UNRESOLVED" as SlotClassification, slot: null, reason: "exact duplicate excluded from count" } : resolveSlot(trip, claimsByIdentity.get(id), usedSlots, required.value);
    if (!excludedFromProgress && (slot.classification === "SLOT_EXPLICIT" || slot.classification === "SLOT_ORDER_PROVEN" || slot.classification === "SLOT_DERIVED_FROM_HISTORICAL_CONTRACT" || slot.classification === "SLOT_DERIVED_FROM_UNIQUE_SEQUENCE")) deterministicSlots += 1;
    else if (!excludedFromProgress) unresolvedSlots += 1;
    if (slot.classification === "SLOT_EXPLICIT" || slot.classification === "SLOT_ORDER_PROVEN") explicitSlots += 1;
    if (slot.classification === "SLOT_DERIVED_FROM_HISTORICAL_CONTRACT" || slot.classification === "SLOT_DERIVED_FROM_UNIQUE_SEQUENCE") derivedSlots += 1;
    const reasons = slot.reason ? [slot.reason] : [];
    if (slot.classification === "SLOT_CONFLICT") blockingReasons.add(slot.reason || "slot conflict");
    reconstructed.push({ tripId: id, duplicateClassification, slotClassification: slot.classification, slot: slot.slot, excludedFromProgress, reasons });
  }
  const provenTrips = reconstructed.filter((trip) => !trip.excludedFromProgress).length;
  const projectedProgress = provenTrips;
  const terminalState = required.value === null ? "UNKNOWN" : projectedProgress > required.value ? "CRITICAL_OVERFLOW" : projectedProgress === required.value ? "COMPLETED_CANDIDATE" : "INCOMPLETE";
  if (required.reason) blockingReasons.add(required.reason);
  if (required.classification !== "REQUIRED_TRIPS_PROVEN") blockingReasons.add(required.classification);
  const scopedClassifications = (input.allScopedTrips || []).map((trip) => input.classificationByTripId?.get(identity(trip)) || "UNCLASSIFIED");
  if (scopedClassifications.includes("UNCLASSIFIED")) blockingReasons.add("unclassified physical trip in operation scope");
  if (scopedClassifications.includes("LEGACY_AMBIGUOUS")) blockingReasons.add("ambiguous operation association");
  if (scopedClassifications.includes("LEGACY_PROBABLE_NOT_SAFE")) blockingReasons.add("legacy operation association not proven");
  if (scopedClassifications.includes("LEGACY_INVALID")) blockingReasons.add("invalid or contradictory historical document");
  if (unresolvedDuplicates || probableDuplicates) blockingReasons.add("duplicate candidates unresolved");
  if (unresolvedSlots) blockingReasons.add("one or more trips have no deterministic slot");
  if (terminalState === "CRITICAL_OVERFLOW") blockingReasons.add("canonicalProgress exceeds requiredTrips");
  const countSafe = !["REQUIRED_TRIPS_CONFLICT", "REQUIRED_TRIPS_INVALID"].includes(required.classification) && !blockingReasons.has("unclassified physical trip in operation scope") && !blockingReasons.has("ambiguous operation association");
  const slotSafe = deterministicSlots === provenTrips && unresolvedSlots === 0 && unresolvedDuplicates === 0 && probableDuplicates === 0;
  const terminalSafe = required.classification === "REQUIRED_TRIPS_PROVEN" && terminalState !== "UNKNOWN" && terminalState !== "CRITICAL_OVERFLOW";
  const migrationSafe = provenTrips > 0 && countSafe && slotSafe && terminalSafe && exactDuplicates === 0 && unresolvedDuplicates === 0 && probableDuplicates === 0 && blockingReasons.size === 0;
  const confidence: ReconstructionConfidence = migrationSafe ? "HIGH" : countSafe ? (slotSafe ? "MEDIUM" : "LOW") : "UNRESOLVED";
  return { operationId, requiredTrips: required.value, requiredTripsClassification: required.classification, provenTrips, deterministicSlots, unresolvedSlots, duplicateCandidates: probableDuplicates + unresolvedDuplicates, exactDuplicates, probableDuplicates, unresolvedDuplicates, terminalState, projectedProgress, reconstructionConfidence: confidence, blockingReasons: [...blockingReasons], trips: reconstructed, gates: { countSafe, slotSafe, terminalSafe, migrationSafe }, explicitSlots, derivedSlots };
}

export function simulateNextTrip(input: { requiredTrips: number; currentProgress: number; usedSlots: readonly number[]; tripId: string }) {
  const next = input.currentProgress + 1;
  const slot = next;
  const accepted = next <= input.requiredTrips && !input.usedSlots.includes(slot);
  return { accepted, tripId: input.tripId, slot: accepted ? slot : null, canonicalProgress: accepted ? next : input.currentProgress, projectedStatus: accepted && next === input.requiredTrips ? "COMPLETED" : "ACTIVE", reason: accepted ? "NEXT_SLOT_DETERMINISTIC" : next > input.requiredTrips ? "CAPACITY_EXCEEDED" : "SLOT_ALREADY_USED" } as const;
}

export function simulateReplay(input: { tripId: string; existingTripIds: readonly string[]; currentProgress: number; requiredTrips: number }) {
  const replay = input.existingTripIds.includes(input.tripId);
  return { replay, createdTrip: !replay, canonicalProgress: input.currentProgress, projectedStatus: input.currentProgress >= input.requiredTrips ? "COMPLETED" : "ACTIVE", reason: replay ? "IDEMPOTENT_REPLAY_NO_MUTATION" : "NEW_IDEMPOTENCY_KEY" } as const;
}

export function simulateOfflineQueue(input: { requiredTrips: number; tripIds: readonly string[]; arrivalOrder: readonly string[] }) {
  const unique = [...new Set(input.arrivalOrder.filter((id) => input.tripIds.includes(id)))].sort((a, b) => input.tripIds.indexOf(a) - input.tripIds.indexOf(b));
  const accepted = unique.slice(0, input.requiredTrips);
  return { acceptedTripIds: accepted, slots: accepted.map((tripId, index) => ({ tripId, slot: index + 1 })), canonicalProgress: accepted.length, projectedStatus: accepted.length === input.requiredTrips ? "COMPLETED" : "ACTIVE", overflowTripIds: unique.slice(input.requiredTrips) } as const;
}
