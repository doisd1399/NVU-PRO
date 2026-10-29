import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankingDisplayName } from "../src/lib/rankingDisplayName.ts";

const page = readFileSync("src/pages/RankingGlobal.tsx", "utf8");
const leaderboard = readFileSync("src/components/RankingGamerLeaderboard.tsx", "utf8");
const podium = readFileSync("src/components/RankingPremiumPodium.tsx", "utf8");
const modal = readFileSync("src/components/RankingParticipantPremiumModal.tsx", "utf8");
const css = readFileSync("src/components/RankingGamer.css", "utf8");
const must = (ok, message) => assert.ok(ok, message);

assert.equal(rankingDisplayName("Cooper log Transporte e Logística"), "Cooper log");
assert.equal(rankingDisplayName("  Thiago   Caetano  da Silva "), "Thiago Caetano");
assert.equal(rankingDisplayName("MATECOM"), "MATECOM");
assert.equal(rankingDisplayName(""), "");
must(!page.includes('<span className="nvu-brand-pro">PRO</span>'), "The ranking header must omit the PRO badge");
must(page.includes("Ranking de Elite") && page.includes("ARENA DE RESULTADOS"), "Thematic ranking title");
must(page.includes('nvu-gamer-controls') && css.includes('.nvu-gamer-ranking .nvu-gamer-controls'), "Minimal filters");
must(leaderboard.includes('className="nvu-gamer-more nvu-gamer-more-inline"'), "Participants action must be inside leaderboard");
must(page.includes('additionalCount={additionalRankingData.length}') && !page.includes('className="nvu-gamer-more"'), "No second participants card outside classification");
must(leaderboard.includes('onToggleAdditional') && leaderboard.includes('aria-expanded={showAdditionalParticipants}'), "Expansion must remain operable");
must(leaderboard.includes('disabled={assetType === "company"}') && podium.includes('disabled={!item || assetType === "company"}'), "Company entries must not be interactive");
must(page.includes('if (rankingType !== "entre") setSelectedParticipant') && page.includes('rankingType !== "entre" && selectedParticipant'), "Prevent opening company profile from both interaction and render");
must(leaderboard.includes('rankingDisplayName(fullName)') && podium.includes('rankingDisplayName(fullName)'), "First two words in podium and rows");
must(modal.includes('rankingDisplayName(item.name)') && modal.includes('rankingDisplayName(companyName)'), "Short names in participant modal");
must(modal.includes('nvu-ranking-profile-earnings') && css.includes('.dark .nvu-ranking-profile-modal .nvu-ranking-profile-earnings'), "Theme-safe earnings contrast");
must(css.includes('.nvu-ranking-profile-identity > span:first-child'), "Profile image alignment");
must(page.includes('ranking-previous-leader-card') && page.includes('previousPeriodLeader'), "Keep previous-period leader data");
console.log('RANKING_459_UI_CONTRACT_PASS (18 checks)');
