/** Do not turn an unchanged authoritative response into a new React update. */
export function applyAuthoritativeJobProjection<T extends { id: string; progress?: number; status?: string }>(
  jobs: T[], jobId: string, progress: number, status?: string,
): T[] {
  if (!jobId || !Number.isFinite(progress)) return jobs;
  const nextProgress = Math.max(0, progress);
  const index = jobs.findIndex(job => job.id === jobId);
  if (index < 0) return jobs;
  const job = jobs[index];
  if (Number(job.progress || 0) === nextProgress && (!status || job.status === status)) return jobs;
  const next = jobs.slice();
  next[index] = { ...job, progress: nextProgress, ...(status ? { status } : {}) };
  return next;
}
