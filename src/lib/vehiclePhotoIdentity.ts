import { collectSimulatorAliases, resolveSimulatorId } from "./resolveSimulator";

export interface VehiclePhotoIdentity {
  userId: string;
  simulatorId: string;
  vehicleId: string;
  vehicleName?: string;
}

export function resolveVehiclePhotoSimulatorId(
  source: unknown,
  simulators: Record<string, unknown>[] = [],
  companies: Record<string, unknown>[] = [],
): string {
  const resolved = resolveSimulatorId(source, simulators, companies);
  if (!resolved || resolved === "all") return "";
  const aliases = collectSimulatorAliases(source);
  const catalogEntry = simulators.find((entry) => entry.id === resolved);
  collectSimulatorAliases(catalogEntry, true).forEach((alias) => aliases.add(alias));
  // Known simulators retain the same photo namespace before/after catalog hydration.
  for (const code of ["gto", "wtds", "wbds", "toe3", "ets2", "ats", "pbs"]) {
    if (aliases.has(code)) return code;
  }
  // An opaque company/catalog ID is not a stable photo namespace until
  // its catalog is loaded. Publishing now would strand the photo under a
  // different key when the canonical simulator alias resolves later.
  const opaque = /^[a-z0-9_-]{18,}$/i.test(resolved) && /[a-z]/.test(resolved)
    && /[0-9]/.test(resolved);
  if (opaque && !catalogEntry) return "";
  return resolved;
}

/**
 * Canonical photo identity is resolved from *every* explicit simulator field.
 * A conflicting legacy field must never be silently ignored in favour of a
 * company or ranking filter. No inference from a company/vehicle name.
 */
export function resolveVehiclePhotoOperationSimulatorEvidence(
  operation: unknown,
  company: unknown,
  selectedSimulatorId: string,
  simulators: Record<string, unknown>[] = [],
  companies: Record<string, unknown>[] = [],
  additionalEvidence: unknown[] = [],
): { simulatorId: string; conflict: boolean } {
  const explicit = (source: unknown): { simulatorId: string; conflict: boolean } => {
    if (!source || typeof source !== "object") return { simulatorId: "", conflict: false };
    const value = source as Record<string, unknown>;
    const keys = ["simulatorId", "simuladorId", "simulatorName", "simuladorNome", "simulator"];
    const ids = keys.flatMap((key) => {
      const candidate = value[key];
      if (typeof candidate !== "string" || !candidate.trim()) return [];
      const simulatorId = resolveVehiclePhotoSimulatorId({ simulatorId: candidate }, simulators, companies);
      return simulatorId ? [simulatorId] : [];
    });
    return { simulatorId: ids[0] || "", conflict: new Set(ids).size > 1 };
  };
  const selected = selectedSimulatorId && selectedSimulatorId !== "all"
    ? resolveVehiclePhotoSimulatorId({ simulatorId: selectedSimulatorId }, simulators, companies) : "";
  const sources = [operation, company, ...additionalEvidence].map(explicit);
  // The UI's selected filter is an invariant, never evidence about the job.
  // Without job/company/vehicle evidence, a filtered ranking must not
  // invent the simulator (and risk displaying another truck's photo).
  const known = sources.map((item) => item.simulatorId).filter(Boolean);
  const evidence = [...known, selected].filter(Boolean);
  const conflict = sources.some((item) => item.conflict) || new Set(evidence).size > 1;
  return { simulatorId: conflict || !known.length ? "" : known[0], conflict };
}

export function resolveVehiclePhotoOperationSimulatorId(
  operation: unknown,
  company: unknown,
  selectedSimulatorId: string,
  simulators: Record<string, unknown>[] = [],
  companies: Record<string, unknown>[] = [],
  additionalEvidence: unknown[] = [],
): string {
  return resolveVehiclePhotoOperationSimulatorEvidence(
    operation, company, selectedSimulatorId, simulators, companies, additionalEvidence,
  ).simulatorId;
}

export function vehiclePhotoKey(identity: VehiclePhotoIdentity): string {
  const fields = [identity.userId, identity.simulatorId, identity.vehicleId];
  if (fields.some((value) => !String(value || "").trim())) {
    throw new Error("VEHICLE_PHOTO_IDENTITY_REQUIRED");
  }
  return `nvu-vehicle-photo:v2:${fields.map((value) => encodeURIComponent(value.trim())).join(":")}`;
}

export function vehiclePhotoDocumentKey(identity: VehiclePhotoIdentity): string {
  vehiclePhotoKey(identity);
  return [identity.simulatorId, identity.vehicleId].map((value) => encodeURIComponent(value.trim())).join(":");
}

/** Firestore key for the minimal authenticated ranking projection. */
export function rankingVehiclePhotoDocumentKey(identity: VehiclePhotoIdentity): string {
  vehiclePhotoKey(identity);
  return [identity.userId, identity.simulatorId, identity.vehicleId].map((value) => encodeURIComponent(value.trim())).join(":");
}

export function belongsToVehiclePhoto(record: unknown, identity: VehiclePhotoIdentity): boolean {
  if (!record || typeof record !== "object") return false;
  const value = record as VehiclePhotoIdentity;
  return value.userId === identity.userId && value.simulatorId === identity.simulatorId
    && value.vehicleId === identity.vehicleId;
}
