import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getRankingUtcMonthlyRange,
  buildRankingUtcPeriodKey,
  formatRankingMonthLabel,
  isRankingPeriodClosed,
} from "../src/lib/rankingPeriods.ts";
import { normalizeDate } from "../src/lib/metricsEngine.ts";

const lateAugustInSaoPaulo = new Date("2026-09-01T01:16:10.000Z");
const augustRange = getRankingUtcMonthlyRange(lateAugustInSaoPaulo);

assert.equal(
  augustRange.start.toISOString(),
  "2026-08-01T03:00:00.000Z",
  "O início de agosto deve ser a meia-noite do calendário de São Paulo",
);
assert.equal(
  augustRange.end.toISOString(),
  "2026-09-01T02:59:59.999Z",
  "O fim de agosto deve ocorrer depois de 31/08 inteiro em São Paulo",
);
assert.equal(
  buildRankingUtcPeriodKey("mes", lateAugustInSaoPaulo),
  "mes_2026-08",
  "31/08 em São Paulo não pode gerar a chave de setembro",
);
assert.equal(
  formatRankingMonthLabel(lateAugustInSaoPaulo),
  "Mês de Agosto",
  "O Ranking Global deve exibir o mês civil oficial, não Mês Atual",
);
assert.equal(
  isRankingPeriodClosed("mes", "2026-08-01", "2026-08-31", lateAugustInSaoPaulo),
  false,
  "A classificação de agosto não pode ser tratada como encerrada antes da virada local",
);
assert.equal(
  isRankingPeriodClosed(
    "mes",
    "2026-08-01",
    "2026-08-31",
    new Date("2026-09-01T03:00:01.000Z"),
  ),
  true,
  "A classificação de agosto deve ficar encerrada após a meia-noite local",
);
assert.equal(
  normalizeDate("2026-08-01").toISOString(),
  "2026-08-01T03:00:00.000Z",
  "Datas de viagem sem horário devem respeitar a meia-noite de São Paulo",
);

const rankingGlobalSource = fs.readFileSync(
  new URL("../src/pages/RankingGlobal.tsx", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  rankingGlobalSource,
  /Mês Atual/,
  "O Ranking Global não deve manter o rótulo genérico Mês Atual",
);
assert.match(
  rankingGlobalSource,
  /formatRankingMonthLabel\(referenceDate\)/,
  "O Ranking Global deve usar o helper mensal canônico",
);

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(
  appSource,
  /isSeniorAuthenticated\s*&&\s*Boolean\(seniorCompanyId\)/,
  "O guard Sênior deve aceitar claim autenticado antes da projeção Firestore",
);

const newsFeedSource = fs.readFileSync(new URL("../src/pages/NewsFeed.tsx", import.meta.url), "utf8");
assert.match(
  newsFeedSource,
  /isClosedRankingPost/,
  "A NVU News deve filtrar rankings mensais ainda abertos",
);
assert.match(
  newsFeedSource,
  /\.filter\(\(post\) => isClosedRankingPost\(post\)\)/,
  "O filtro de período fechado deve ser aplicado no processamento do feed",
);

console.log("Ranking calendar period contract passed: month label + Senior guard + closed News ranking gate");
