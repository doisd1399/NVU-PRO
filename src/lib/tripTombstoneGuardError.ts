/** A deleted trip identity is never silently recycled. It may have a remote
 * deletion, deduplication lock, or audit event even if the local journal is empty.
 * This is an identity rule, not a failed browser-storage write. */
export const TRIP_TOMBSTONE_GUARD = "CANONICAL_TRIP_TOMBSTONED" as const;

export function makeTombstoneGuardError(): Error & {
  code: typeof TRIP_TOMBSTONE_GUARD;
  localCommitPhase: "identity-tombstone-check";
  tripSyncStage: "IDENTITY_GUARD";
} {
  return Object.assign(new Error(TRIP_TOMBSTONE_GUARD), {
    code: TRIP_TOMBSTONE_GUARD,
    localCommitPhase: "identity-tombstone-check" as const,
    tripSyncStage: "IDENTITY_GUARD" as const,
  });
}
