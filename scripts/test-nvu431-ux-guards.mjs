import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const money = read("src/components/common/HistoryMoneySummary.tsx");
assert.match(money, /known\.map\(\(group\) =>/);
assert.match(money, /formatHistoryMoney\(group\.value, group\.currency, group\.currencyStatus\)/);
assert.match(money, /<details className=/);
assert.match(money, /<summary className=.*>Detalhes<\/summary>/);
assert.doesNotMatch(money, /Subtotal conhecido em BRL|viagens com moeda informada/i);

const coverage = read("src/components/common/HistoryReadCoverageNotice.tsx");
assert.match(coverage, /if \(queryComplete && !scopedHistory\) return null/);
assert.match(coverage, /return \(\s*<details className=/);
assert.match(coverage, /<summary[^>]*>Detalhes do histórico<\/summary>/);
assert.match(coverage, /Ver diagnóstico somente leitura/);
assert.doesNotMatch(coverage, /<details[^>]*\sopen(?:=|\s|>)/i);

const failed = read("src/components/common/FailedHistoryRegistrationRecovery.tsx");
assert.match(failed, /syncEngine\.inspectFailedHistoryRegistrations\(companyId\)/);
assert.match(failed, /return \(\s*<details className=/);
assert.match(failed, /Pendências locais \(somente leitura\)/);
assert.match(failed, /Abrir este diagnóstico não envia, altera nem repete dados/);
assert.doesNotMatch(failed, /syncEngine\.(?:retry|replay|register|submit|enqueue|upsert|delete|send)\s*\(/i);
assert.doesNotMatch(failed, /<button\b|useEffect\s*\(/);
assert.doesNotMatch(failed, /<details[^>]*\sopen(?:=|\s|>)/i);

const history = read("src/pages/driver/TripHistory.tsx");
assert.match(history, /<HistoryReadCoverageNotice\b/);
assert.match(history, /<FailedHistoryRegistrationRecovery\b/);
assert.match(history, /<HistoryMoneySummary\b/);
assert.doesNotMatch(history, /Subtotal conhecido em BRL|X viagens com moeda informada/i);

const operation = read("src/components/OperationResultModal.tsx");
assert.match(operation, /<HistoryMoneySummary/);
assert.match(operation, /groups=\{resultData\.moneyGroups \|\| \[\]\}/);
assert.match(operation, /totalEligibleTrips=\{resultData\.totalViagens\}/);
assert.match(operation, /grid grid-cols-2 gap-2/);
assert.ok(operation.indexOf("Viagens") < operation.indexOf("Ganhos"));
assert.doesNotMatch(operation, /Moeda não registrada|valor fora de subtotal monetário/i);

const rankingCard = read("src/components/ProfileRankingPerformanceCard.tsx");
const statsStart = rankingCard.indexOf('<div className="grid grid-cols-2 gap-3">');
const statsEnd = rankingCard.indexOf("</div>\n      {ready && summary.hasActivity", statsStart);
assert.ok(statsStart >= 0 && statsEnd > statsStart);
const statsMarkup = rankingCard.slice(statsStart, statsEnd);
assert.ok(statsMarkup.indexOf("Viagens") < statsMarkup.indexOf("Ganhos"));

const rankingPage = read("src/pages/RankingGlobal.tsx");
assert.match(rankingPage, /rankingData\.length === 0/);
assert.match(rankingPage, /data-testid="ranking-empty-state"/);
assert.match(rankingPage, /data-testid="ranking-error-state"/);
assert.match(rankingPage, /data-testid="ranking-loading-state"/);
assert.match(rankingPage, /viewType === "podio"/);
assert.match(rankingPage, /rankingData\.slice\(viewType === "podio" \? 3 : 0\)/);
assert.match(rankingPage, /formatRankingCurrency/);
assert.match(rankingPage, /const useTripFallback = rankingType === "interno"/);

console.log("nvu431-ux-guards: 37 source invariants passed; states, podio/lista and privacy guards retained");
