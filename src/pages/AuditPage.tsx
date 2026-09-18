import React, { useEffect, useState } from "react";
import { useCompanyStore } from "../context/CompanyContext";
import { useSessionStore } from "../context/AppContext";
import { getFilteredTrips } from "../lib/metricsEngine";
import { normalizeTrip } from "../lib/tripNormalizer";
import { useTripHistory } from "../hooks/useTripHistory";

export default function AuditPage() {
  const { companies, activeCompanyId } = useCompanyStore();
  const { currentUser } = useSessionStore();
  const { historicoTrips = [] } = useTripHistory(activeCompanyId, {
    userId: currentUser?.id,
  });
  const [report, setReport] = useState<string>("Calculando...");

  useEffect(() => {
    if (!historicoTrips || !companies) return;
    if (companies.length === 0 || historicoTrips.length === 0) return;

    try {
      const dcTransportes = companies.find((c) => c.companyName === "DC Transportes");
      const dcId = dcTransportes?.id;

      const normalizedTrips = historicoTrips.map((t) => normalizeTrip(t as any));

      const histStartDate = new Date("2026-06-01T00:00:00");
      const histEndDate = new Date("2026-06-30T23:59:59");
      histEndDate.setMilliseconds(999);

      const histTrips = getFilteredTrips(
        normalizedTrips,
        histStartDate,
        histEndDate,
        dcId,
        "Todos os simuladores",
        companies,
        "Todos os Motoristas"
      );

      // Reproduzindo o getCustomRange original (sem a correção)
      const getCustomRangeUnfixed = (start: Date | string, end: Date | string) => {
        const s = new Date(start);
        const startDate = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0);
        const e = new Date(end);
        const endDate = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999);
        return { start: startDate, end: endDate };
      };

      const { start: rankingStart, end: rankingEnd } = getCustomRangeUnfixed("2026-06-01", "2026-06-30");

      const rankingTrips = getFilteredTrips(
        normalizedTrips,
        rankingStart,
        rankingEnd,
        dcId,
        "Todos os simuladores",
        companies,
        undefined
      );

      const tableData: Record<string, { histTrips: number; rankTrips: number; diff: number; histVal: number; rankVal: number }> = {};
      
      for (let d = 31; d <= 31; d++) {
        tableData[`31/05/2026`] = { histTrips: 0, rankTrips: 0, diff: 0, histVal: 0, rankVal: 0 };
      }
      for (let d = 1; d <= 30; d++) {
        const dStr = `${d.toString().padStart(2, '0')}/06/2026`;
        tableData[dStr] = { histTrips: 0, rankTrips: 0, diff: 0, histVal: 0, rankVal: 0 };
      }

      const getDateStr = (timestamp: number) => {
        const date = new Date(timestamp);
        return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
      };

      for (const t of histTrips) {
        const str = getDateStr(t.normalizedDataJob);
        if (!tableData[str]) tableData[str] = { histTrips: 0, rankTrips: 0, diff: 0, histVal: 0, rankVal: 0 };
        tableData[str].histTrips++;
        tableData[str].histVal += t.normalizedValor;
      }

      for (const t of rankingTrips) {
        const str = getDateStr(t.normalizedDataJob);
        if (!tableData[str]) tableData[str] = { histTrips: 0, rankTrips: 0, diff: 0, histVal: 0, rankVal: 0 };
        tableData[str].rankTrips++;
        tableData[str].rankVal += t.normalizedValor;
      }

      let relatorio = `Data | Qtd Histórico | Qtd Ranking | Diferença | Valor Histórico | Valor Ranking\n`;
      relatorio += `--- | --- | --- | --- | --- | ---\n`;

      const sortedDates = Object.keys(tableData).sort((a, b) => {
        const [d1, m1, y1] = a.split('/').map(Number);
        const [d2, m2, y2] = b.split('/').map(Number);
        return new Date(y1, m1-1, d1).getTime() - new Date(y2, m2-1, d2).getTime();
      });

      let totalHistTrips = 0;
      let totalRankTrips = 0;
      let totalDiff = 0;

      for (const date of sortedDates) {
        const data = tableData[date];
        data.diff = data.histTrips - data.rankTrips;
        
        totalHistTrips += data.histTrips;
        totalRankTrips += data.rankTrips;
        totalDiff += data.diff;

        if (data.histTrips > 0 || data.rankTrips > 0) {
           relatorio += `${date} | ${data.histTrips} | ${data.rankTrips} | ${data.diff} | R$ ${data.histVal.toFixed(2)} | R$ ${data.rankVal.toFixed(2)}\n`;
        }
      }

      relatorio += `\nTotal Histórico: ${totalHistTrips} viagens`;
      relatorio += `\nTotal Ranking: ${totalRankTrips} viagens`;
      relatorio += `\nDiferença Total: ${totalHistTrips - totalRankTrips} viagens`;

      const trips3105 = rankingTrips.filter(t => getDateStr(t.normalizedDataJob) === '31/05/2026');
      const trips3006 = histTrips.filter(t => getDateStr(t.normalizedDataJob) === '30/06/2026');

      relatorio += `\n\nQtd 31/05: ${trips3105.length}\n`;
      relatorio += `Qtd 30/06: ${trips3006.length}\n`;

      relatorio += `\nIDs 31/05: ${trips3105.map(t => t.id).join(', ')}\n`;
      relatorio += `IDs 30/06: ${trips3006.map(t => t.id).join(', ')}\n`;

      setReport(relatorio);
    } catch (err: any) {
      setReport("Erro na auditoria: " + err.message);
    }
  }, [historicoTrips, companies]);

  return (
    <div className="p-8 bg-white dark:bg-black min-h-screen text-black dark:text-white">
      <h1 className="text-2xl font-bold mb-4">Auditoria</h1>
      <pre className="whitespace-pre-wrap font-mono text-sm">{report}</pre>
    </div>
  );
}
