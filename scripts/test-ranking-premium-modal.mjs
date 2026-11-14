import fs from "node:fs";
import assert from "node:assert/strict";

const page = fs.readFileSync("src/pages/RankingGlobal.tsx", "utf8");
const modal = fs.readFileSync("src/components/RankingParticipantPremiumModal.tsx", "utf8");
const podium = fs.readFileSync("src/components/RankingPremiumPodium.tsx", "utf8");
const list = fs.readFileSync("src/components/RankingGamerLeaderboard.tsx", "utf8");

const mustContain = (source, markers, label) => {
  for (const marker of markers) assert.ok(source.includes(marker), `${label}: marcador ausente: ${marker}`);
};

mustContain(page, [
  "RankingParticipantPremiumModal",
  "selectedParticipant",
  "additionalCount={additionalRankingData.length}",
  "onOpen={openParticipant}",
  "items={rankingData}",
  "RankingPremiumPodium",
], "RankingGlobal");

mustContain(list, ["Ver demais participantes", "aria-expanded={showAdditionalParticipants}", "nvu-gamer-more-inline"], "RankingGamerLeaderboard");

mustContain(podium, [
  'rank: 2, index: 1', 'rank: 1, index: 0', 'rank: 3, index: 2',
  'onClick={() => item && onOpen(item, rank)}', 'persistentAssetId={`${assetType}:${item.id}`}',
], "RankingPremiumPodium");

mustContain(modal, [
  "useProfileRanking",
  "buildClassificationPeriods",
  "useVehiclePhoto",
  "operationProgressReconciled !== false",
  "Indisponível para este participante",
  "Última versão salva no aparelho",
  "event.key === \"Escape\"",
  "backButton",
  "makeRankingPremiumCacheKey",
  "writeRankingPremiumCache",
  "visibleCounts",
  "historyType",
  "Math.min(20",
  "role=\"dialog\"",
  "aria-modal=\"true\"",
  "registerOptionModal",
  "periodLabel",
  "nvu-profile-summary",
  "rank}º",
], "PremiumModal");

assert.equal((modal.match(/buildClassificationPeriods\(/g) || []).length, 1, "Histórico deve usar a fonte de períodos existente");
assert.equal((page.match(/<RankingParticipantPremiumModal/g) || []).length, 1, "Modal deve ter um único ponto de montagem");
console.log("RANKING_PREMIUM_MODAL_CONTRACT_PASS; local static contract only");
