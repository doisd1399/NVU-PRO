export type HistoryReadEvidence = {
  version: 1;
  collection: "historico_viagens";
  physicalDocumentId: string;
  transport: "server" | "cache" | "pending";
};

/** A read receipt does not confirm any command or operational slot. */
export function hasHistoricalReadEvidence(trip: Record<string, unknown>): boolean {
  const receipt = trip.historyReadEvidence as HistoryReadEvidence | undefined;
  return receipt?.version === 1 && receipt.collection === "historico_viagens" &&
    Boolean(receipt.physicalDocumentId) && receipt.physicalDocumentId === String(trip.physicalDocumentId || "").trim() &&
    (receipt.transport === "server" || receipt.transport === "cache");
}
