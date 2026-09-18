export type ProDuplicateScope = {
  jobId: string;
  driverId: string;
  companyId: string;
  simulatorKey?: string;
  amountCents: number;
};

export type ProDuplicateCandidate = {
  id: string;
  jobId?: string;
  driverId?: string;
  companyId?: string;
  simulatorKey?: string;
  amountCents: number;
  isValid: boolean;
  simpleAutomation: boolean;
  metricDateMs: number;
};

function text(value: unknown): string {
  return String(value || "").trim();
}

export function findLatestConsecutiveProDuplicate(
  candidates: readonly ProDuplicateCandidate[],
  scope: ProDuplicateScope,
): ProDuplicateCandidate | null {
  const amountCents = Math.round(Number(scope.amountCents));
  if (
    !text(scope.jobId) ||
    !text(scope.driverId) ||
    !text(scope.companyId) ||
    !Number.isFinite(amountCents) ||
    amountCents <= 0
  ) {
    return null;
  }

  const scoped = candidates
    .filter((candidate) => {
      const simulatorMatches = !text(scope.simulatorKey)
        || text(candidate.simulatorKey) === text(scope.simulatorKey);
      return candidate.isValid
        && candidate.simpleAutomation === true
        && text(candidate.jobId) === text(scope.jobId)
        && text(candidate.driverId) === text(scope.driverId)
        && text(candidate.companyId) === text(scope.companyId)
        && simulatorMatches;
    })
    .sort((left, right) => {
      const rightTime = Number.isFinite(right.metricDateMs) ? right.metricDateMs : 0;
      const leftTime = Number.isFinite(left.metricDateMs) ? left.metricDateMs : 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return text(right.id).localeCompare(text(left.id));
    });

  const latest = scoped[0];
  return latest && Math.round(Number(latest.amountCents)) === amountCents
    ? latest
    : null;
}
