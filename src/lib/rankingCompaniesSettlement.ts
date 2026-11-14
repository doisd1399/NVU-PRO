/**
 * Outcome of confirming a ranking's companies with the server (public_companies, chunks of ids).
 *
 * A company that the server answered for but does not list is CONFIRMED ABSENT (deleted or archived since the period was
 * consolidated). That is a definite answer, not a failure: the ranking simply has no eligible company for that id. Only a
 * failed or timed-out chunk leaves the set unconfirmed. Previously one deleted company in a past month made the whole
 * month show "Falha ao carregar" forever.
 */
export type ChunkResult = PromiseSettledResult<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;

export function settleCompanyChunks(ids: string[], results: ChunkResult[]) {
  const merged = new Map<string, Record<string, unknown>>();
  let firstError: unknown = null;
  for (const result of results) {
    if (result.status === "rejected") { firstError ||= result.reason; continue; }
    for (const document of result.value.docs) merged.set(document.id, { ...document.data(), id: document.id });
  }
  const confirmed = results.length > 0 && results.every(result => result.status === "fulfilled");
  return { merged, firstError, confirmed, absent: confirmed ? ids.filter(id => !merged.has(id)) : [] };
}

/** Absent companies are re-checked sooner: a company that was only just created may not have its public entry yet. */
export const ABSENT_RECHECK_MS = 60_000;
