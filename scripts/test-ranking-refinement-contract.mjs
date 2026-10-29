import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page = readFileSync("src/pages/RankingGlobal.tsx", "utf8");
const css = readFileSync("src/components/RankingGamer.css", "utf8");
const list = readFileSync("src/components/RankingGamerLeaderboard.tsx", "utf8");
const podium = readFileSync("src/components/RankingPremiumPodium.css", "utf8");
const decor = readFileSync("src/components/RankingGamerDecor.tsx", "utf8");
const checks = [
  ["filtros iniciam compactos", page.includes('filtersExpanded') && css.includes('.nvu-gamer-controls.is-collapsed')],
  ["resumo dos filtros ativos", page.includes('Filtros do ranking') && page.includes('simulatorLabel') && page.includes('rankingPeriodLabel')],
  ["expansão acessível em um toque", page.includes('aria-controls="ranking-gamer-filter-body"') && page.includes('aria-expanded={filtersExpanded}')],
  ["período com modal premium por tema", page.includes('nvu-gamer-period-modal') && css.includes('.nvu-gamer-period-option[aria-pressed="true"]')],
  ["fotos também na lista expandida", page.includes("showPhotos") && list.includes("nvu-gamer-row-photo")],
  ["cache persistente mantém identidade", page.includes('persistentAssetId') && page.includes('preloadRankingImages')],
  ["último período usa agregado fechado", page.includes('previousRankingAggregateState') && page.includes('previousPeriodReferenceDate')],
  ["diferença só com moeda comparável", page.includes('comparableRankingMoney') && page.includes('previousLeaderComparison')],
  ["card real do líder anterior", page.includes('ranking-previous-leader-card') && page.includes('previousPeriodLeader.name')],
  ["molduras vetoriais nativas", decor.includes('<svg') && decor.includes('GamerFrame') && !page.includes('reference.png')],
  ["cabeçalho centralizado sem troféu genérico", page.includes('nvu-ranking-header-centered') && !page.includes('nvu-ranking-header-centered"><Trophy')],
  ["escopos preservados", page.includes('rankingType === "entre"') && page.includes('rankingType === "interno"') && page.includes('rankingType === "global"')],
];
for (const [name, ok] of checks) { assert.ok(ok, `REFINEMENT FAIL: ${name}`); console.log(`PASS ${name}`); }
console.log(`RANKING_REFINEMENT_CONTRACT_PASS ${checks.length} checks`);
