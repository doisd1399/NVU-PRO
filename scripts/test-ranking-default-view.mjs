import assert from "node:assert/strict";
import fs from "node:fs";

// The Ranking opens on the view that fits the profile: Global for a driver, Empresarial for a company profile, unless the
// profile card asked for a specific view (profileRanking intent).
const page = fs.readFileSync("src/pages/RankingGlobal.tsx", "utf8");
assert.match(page, /const \{ currentUser, activeRole \} = useSessionStore\(\)/, "the role comes from the session");
assert.match(page, /useState<"entre" \| "interno" \| "global">\(\s*(?:\/\/[^\n]*\n\s*)?profileRankingType \|\| \(activeRole === "admin" \? "entre" : "global"\),?\s*\)/,
  "initial view: the requested one, else Empresarial for admin and Global for a driver");
assert.ok(page.indexOf("const { currentUser, activeRole } = useSessionStore()") < page.indexOf('useState<"entre" | "interno" | "global">('), "the role is read before the state that uses it");
assert.match(page, /aria-pressed=\{rankingType === "global"\}.*<Globe2/, "the Global tab exists");
assert.match(page, /aria-pressed=\{rankingType === "entre"\}.*<Building2[^<]*\/>Empresarial/, "the Empresarial tab exists");
console.log("RANKING_DEFAULT_VIEW_PASS");
