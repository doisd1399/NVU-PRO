export type RemainingDebtInput = {
  divergentTotal: number;
  requiredTripsMissing: number;
  criticalOverflow: number;
  manualReview: number;
  incompleteOrMissingCanonicalTrips: number;
};
export type RemainingDebtClassification = {
  total: number;
  buckets: {
    CRITICAL_OVERFLOW: number;
    REQUIRED_TRIPS_RECOVERY: number;
    MANUAL_REVIEW_CANONICAL_EVIDENCE: number;
  };
  mutuallyExclusive: true;
  safeToApply: false;
  basis: string[];
};
/**
 * Converts the certified V7.6 overlapping debt counters into an exclusive
 * ledger. `manualReview` includes BLOCKED/MISSING, so it must not be added to
 * overflow. The 439 residual manual-review cases are the non-overflow,
 * non-requiredTripsMissing remainder recorded by the certified debt artifact.
 */
export function classifyRemainingDebt(input: RemainingDebtInput): RemainingDebtClassification {
  for (const value of Object.values(input)) {
    if (!Number.isInteger(value) || value < 0) throw new Error("INVALID_DEBT_COUNT");
  }
  const manualResidual = input.divergentTotal - input.criticalOverflow - input.requiredTripsMissing;
  if (manualResidual < 0 || manualResidual !== input.incompleteOrMissingCanonicalTrips) {
    throw new Error("DEBT_COUNTERS_NOT_RECONCILED");
  }
  return {
    total: input.divergentTotal,
    buckets: {
      CRITICAL_OVERFLOW: input.criticalOverflow,
      REQUIRED_TRIPS_RECOVERY: input.requiredTripsMissing,
      MANUAL_REVIEW_CANONICAL_EVIDENCE: manualResidual,
    },
    mutuallyExclusive: true,
    safeToApply: false,
    basis: [
      "CRITICAL_OVERFLOW is isolated first; no clamp or exclusion is permitted.",
      "REQUIRED_TRIPS_RECOVERY contains only operations without proven quantity.",
      "MANUAL_REVIEW_CANONICAL_EVIDENCE is the exact residual after the two hard blockers.",
    ],
  };
}
