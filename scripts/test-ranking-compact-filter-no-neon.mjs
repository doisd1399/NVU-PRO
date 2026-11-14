import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Lightweight regression contract, no npm dependencies or Firebase access.
const controls = readFileSync('src/components/RankingGamer.css', 'utf8');
const podium = readFileSync('src/components/RankingPremiumPodium.css', 'utf8');
const page = readFileSync('src/pages/RankingGlobal.tsx', 'utf8');
const checks = [
  ['filter card has a narrower responsive maximum', /\.nvu-gamer-ranking \.nvu-gamer-controls\s*\{[^}]*max-width:\s*470px/s.test(controls)],
  ['filter card has symmetric horizontal inset', /\.nvu-gamer-ranking \.nvu-gamer-controls\s*\{[^}]*width:\s*calc\(100% - 32px\)/s.test(controls)],
  ['narrow phones preserve space for filter options', /\.nvu-gamer-ranking \.nvu-gamer-controls\s*\{[^}]*min-width:\s*min\(100%, 320px\)/s.test(controls)],
  ['filter card remains horizontally centered', /\.nvu-gamer-ranking \.nvu-gamer-controls\s*\{[^}]*margin-inline:\s*auto/s.test(controls)],
  ['podium does not apply accent glow on focus', !/\.nvu-podium-slot:focus-within\s*\{[^}]*var\(--gamer-accent\)/s.test(podium)],
  ['focused participant preserves panel background', /\.nvu-podium-participant:focus-visible\s*\{[^}]*background:\s*var\(--gamer-panel\)/s.test(podium)],
  ['touch focus does not keep selection outline', /\.nvu-gamer-ranking \.nvu-podium-participant:focus:not\(:focus-visible\)/.test(controls)],
  ['keyboard focus remains visible and neutral', /\.nvu-gamer-ranking \.nvu-podium-participant:focus-visible,[\s\S]*?outline:\s*2px solid var\(--gamer-muted\)/.test(controls)],
  ['fixed ranking title is preserved', /const pageTitle = "Ranking Global"/.test(page)],
  ['rank filters retain their three modes', ['Global', 'Interno', 'Empresarial'].every(mode => page.includes(`>${mode}</button>`))],
  ['opening the participant profile is preserved', page.includes('onOpen={openParticipant}')],
];
for (const [description, ok] of checks) {
  assert.ok(ok, description);
  console.log(`PASS ${description}`);
}
console.log(`RANKING_COMPACT_FILTER_NO_NEON_PASS ${checks.length} checks`);
