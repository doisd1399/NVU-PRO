import fs from "node:fs";
import assert from "node:assert/strict";

const modal = fs.readFileSync("src/components/RankingParticipantPremiumModal.tsx", "utf8");
const ranking = fs.readFileSync("src/pages/RankingGlobal.tsx", "utf8");
const css = fs.readFileSync("src/components/RankingParticipantPremiumModal.css", "utf8");
const back = fs.readFileSync("src/lib/safeBackNavigation.ts", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");
const checks = [
  ["cabeçalho compacto de perfil sem nome duplicado", modal.includes('nvu-profile-header') && modal.includes('Perfil do motorista') && modal.includes('Perfil da empresa')],
  ["posição abaixo do nome e identidade", modal.includes("{rank}º") && modal.includes('aria-labelledby={titleId}') && modal.includes("nvu-profile-ranking-line")],
  ["indicadores compactos", modal.includes("{periodLabel}") && modal.includes("nvu-profile-summary") && modal.includes("nvu-profile-company") && modal.includes("Viagens")],
  ["veículo panorâmico sem cartão genérico", css.includes("aspect-ratio: 2.8 / 1") && css.includes("object-fit: cover")],
  ["logo empresarial canônica", modal.includes("company?.logoUrl") && modal.includes("company?.logoURL") && modal.includes("company?.companyLogoURL")],
  ["histórico semanal/mensal independente", modal.includes("visibleCounts") && modal.includes("historyType") && modal.includes("Math.min(20")],
  ["foto usa participante selecionado pelo seletor canônico", modal.includes("selectCurrentOperationJob") && modal.includes('useRankingParticipantVehicle(isCompany ? "" : participantId') && modal.includes("userId: participantId") && !modal.includes("currentUserId === participantId ? jobs.filter")],
  ["cache persistente separado", modal.includes("makeRankingPremiumCacheKey") && modal.includes("writeRankingPremiumCache")],
  ["Voltar Android e foco", modal.includes("registerOptionModal") && back.includes("dismissTopOptionModal()") && modal.includes("event.key === \"Escape\"")],
  ["ranking mantém seleção clicável", ranking.includes("RankingParticipantPremiumModal") && ranking.includes("openParticipant")],
  ["regras não ampliam historico_viagens", rules.includes("match /historico_viagens/{tripId}") && rules.includes("allow create: if false")],
];
for (const [name, ok] of checks) { assert.ok(ok, `R3 PREMIUM FAIL: ${name}`); console.log(`PASS ${name}`); }
console.log(`R3_PREMIUM_MODAL_CONTRACT_PASS ${checks.length} checks`);
