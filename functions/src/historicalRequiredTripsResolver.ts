type Data = Record<string, any>;

export type RequiredTripsProvenance =
  | "CURRENT_PROVEN"
  | "LEGACY_PROVEN"
  | "MULTISOURCE_PROVEN"
  | "PROBABLE"
  | "MISSING"
  | "CONFLICT"
  | "INVALID";

export type RequiredTripsResolution = {
  value: number | null;
  provenance: RequiredTripsProvenance;
  evidenceReason: string;
  sources: Array<{ source: string; field: string; value: number }>;
  shadow: { oldProgress: number | null; canonicalProgress: number | null; divergence: number | null };
};

const text = (v: unknown) => String(v ?? "").trim();
const positive = (v: unknown): number | null => {
  if (v === undefined || v === null || text(v) === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const present = (v: unknown) => v !== undefined && v !== null && text(v) !== "";

function sourceValue(source: string, row: Data | undefined, field: string) {
  if (!row || !present(row[field])) return null;
  const value = positive(row[field]);
  return value === null ? { source, field, value: null as number | null, invalid: true } : { source, field, value, invalid: false };
}

export function resolveHistoricalRequiredTrips(input: {
  operation: Data;
  contract?: Data;
  canonicalProgress?: number | null;
}): RequiredTripsResolution {
  const operation = input.operation || {};
  const contract = input.contract || {};
  const candidates = [
    sourceValue("operation", operation, "requiredTrips"),
    sourceValue("operation", operation, "totalDeliveries"),
    sourceValue("contract", contract, "requiredTrips"),
    sourceValue("contract", contract, "totalDeliveries"),
    Array.isArray(contract.deliveries) && contract.deliveries.length > 0
      ? { source: "contract", field: "deliveries.length", value: contract.deliveries.length, invalid: false }
      : null,
  ].filter(Boolean) as Array<{ source: string; field: string; value: number | null; invalid?: boolean }>;

  if (candidates.some((item) => item.invalid)) {
    return { value: null, provenance: "INVALID", evidenceReason: "a requiredTrips source is present but is not a positive integer", sources: candidates.filter((item) => !item.invalid && item.value !== null).map(({ source, field, value }) => ({ source, field, value: value as number })), shadow: { oldProgress: Number.isInteger(Number(operation.progress)) ? Number(operation.progress) : null, canonicalProgress: input.canonicalProgress ?? null, divergence: null } };
  }
  const valid = candidates.filter((item) => item.value !== null) as Array<{ source: string; field: string; value: number }>;
  const sources = valid.map(({ source, field, value }) => ({ source, field, value }));
  const oldProgress = Number.isInteger(Number(operation.progress)) ? Number(operation.progress) : null;
  const canonicalProgress = input.canonicalProgress ?? null;
  const shadow = { oldProgress, canonicalProgress, divergence: oldProgress !== null && canonicalProgress !== null ? canonicalProgress - oldProgress : null };
  if (!valid.length) return { value: null, provenance: "MISSING", evidenceReason: "no historical or current field proves requiredTrips; progress is not used as a quantity source", sources, shadow };
  const values = [...new Set(valid.map((item) => item.value))];
  if (values.length > 1) return { value: null, provenance: "CONFLICT", evidenceReason: "independent requiredTrips sources disagree", sources, shadow };
  const value = values[0];
  const hasCurrent = valid.some((item) => item.source === "operation" && (item.field === "requiredTrips" || item.field === "totalDeliveries"));
  const hasLegacy = valid.some((item) => item.source === "contract");
  const provenance: RequiredTripsProvenance = hasCurrent && hasLegacy ? "MULTISOURCE_PROVEN" : hasCurrent ? "CURRENT_PROVEN" : "LEGACY_PROVEN";
  return { value, provenance, evidenceReason: hasCurrent && hasLegacy ? "operation and contract sources agree" : hasCurrent ? "operation persisted the required quantity" : "contract historical source proves the required quantity", sources, shadow };
}

export function buildShadowModeComparison(input: { oldProgress: number | null; canonicalProgress: number | null; requiredTrips: number | null }) {
  const divergence = input.oldProgress !== null && input.canonicalProgress !== null ? input.canonicalProgress - input.oldProgress : null;
  return { oldProgress: input.oldProgress, canonicalProgress: input.canonicalProgress, requiredTrips: input.requiredTrips, divergence, diverged: divergence !== null && divergence !== 0, authority: "canonical-future-only", mutation: "none" } as const;
}
