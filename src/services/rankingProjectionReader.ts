/**
 * Reads the server's compact Ranking rows for one participant (rankingParticipantOperations).
 * Returns null whenever the projection cannot be trusted or reached, and the caller then uses the full-history path.
 * That keeps the Ranking working before the Functions are published, with an older server, and offline.
 */
export type ProjectionPorts = {
  /** The projection document: `exists` false when there is none; `fromCache` when it was not confirmed by the server. */
  readDocument: (participantId: string) => Promise<{ exists: boolean; data: any; fromCache: boolean }>;
  /** Asks the server to create the projection (and returns its rows). */
  ensure: (participantId: string) => Promise<any>;
};
export type ProjectionRows = { rows: Record<string, any>[]; fromCache: boolean };

export async function readProjectionRows(participantId: string, ports: ProjectionPorts): Promise<ProjectionRows | null> {
  try {
    const snapshot = await ports.readDocument(participantId);
    if (snapshot.exists) {
      const data = snapshot.data || {};
      return data.schemaVersion === 1 && Array.isArray(data.rows) ? { rows: data.rows, fromCache: snapshot.fromCache } : null;
    }
    // "Missing" is only meaningful when the server said so; an offline cache miss proves nothing.
    if (snapshot.fromCache) return null;
  } catch { return null; }
  try {
    const answer = await ports.ensure(participantId);
    return answer?.success === true && answer.participantId === participantId && answer.schemaVersion === 1 && Array.isArray(answer.rows)
      ? { rows: answer.rows, fromCache: false } : null;
  } catch { return null; }
}
