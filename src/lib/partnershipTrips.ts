import { roleIn, type Partnership } from "./partnerships";

/**
 * Viagens de uma parceria como a contratante as enxerga: o ranking já conta a pontuação para ela; aqui as viagens (livro do acordo,
 * lido do próprio documento da parceria) entram também no resumo operacional, no histórico e nos relatórios da empresa.
 * A executora não precisa disto: as viagens já são da empresa dela.
 */
export function partnershipTripRecords(rows: Partnership[], companyId: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of rows) {
    if (roleIn(p, companyId) !== "contractor" || p.executorCompanyId === companyId) continue;
    for (const entry of p.ledger) {
      if (!entry.at || !(entry.cents >= 0)) continue;
      const id = `pt_${p.id}_${entry.n}`, at = new Date(entry.at);
      out.push({
        id, tripId: id, jobId: `pn_${p.id}`, companyId, empresaId: companyId, empresaNome: p.contractorName, simulatorId: p.simulatorId,
        status: "completed", recordStatus: "completed", completedAt: at, serverValidatedAt: at, syncStatus: "synced",
        valorCents: entry.cents, valor: entry.cents / 100, currency: p.currency, currencyStatus: "known",
        driverId: p.driverId || "", motoristaId: p.driverId || "", driverName: p.driverName || "", motoristaNome: p.driverName || "",
        vehicleName: p.vehicleName || "", operationName: p.operationName, contractName: p.operationName, contractId: `pc_${p.id}`,
        partnership: true, partnershipId: p.id, partnershipRole: "contractor", partnershipExecutorName: p.executorName, partnershipTripNumber: entry.n,
      });
    }
  }
  return out;
}
