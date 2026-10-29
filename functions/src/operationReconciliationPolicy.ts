export type ReconciliationProgressDecision = {
  reportedProgress: number | null;
  confirmedCount: number;
  progressMismatch: boolean;
  unresolvedDownwardGap: boolean;
  canRepairProgress: boolean;
  nextProgress: number;
};

/**
 * Pure safety policy for the denormalized operation counter.
 *
 * A history projection may increase progress when it proves additional
 * confirmed receipts. It may decrease progress only when explicit server
 * evidence proves a deletion/orphan. A narrower/legacy-incomplete query by
 * itself is never evidence that completed work disappeared.
 */
export function decideReconciledProgress(input: {
  reportedProgress: unknown;
  confirmedCount: number;
  safeDecreaseEvidence: boolean;
  hasConflict: boolean;
}): ReconciliationProgressDecision {
  const parsed = Number(input.reportedProgress);
  const reportedProgress = Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  const confirmedCount = Math.max(0, Math.trunc(Number(input.confirmedCount) || 0));
  const progressMismatch = reportedProgress == null || reportedProgress !== confirmedCount;
  const unresolvedDownwardGap = reportedProgress != null &&
    reportedProgress > confirmedCount && !input.safeDecreaseEvidence;
  const canRepairProgress = progressMismatch && !input.hasConflict && !unresolvedDownwardGap && (
    reportedProgress == null ||
    confirmedCount > reportedProgress ||
    (confirmedCount < reportedProgress && input.safeDecreaseEvidence)
  );
  return {
    reportedProgress,
    confirmedCount,
    progressMismatch,
    unresolvedDownwardGap,
    canRepairProgress,
    nextProgress: canRepairProgress ? confirmedCount : (reportedProgress ?? confirmedCount),
  };
}
