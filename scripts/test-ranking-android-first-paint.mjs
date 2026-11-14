import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const ranking = read("src/pages/RankingGlobal.tsx");
const users = read("src/hooks/useRankingUsersRealtime.ts");

const checks = [];
const check = (name, condition) => checks.push({ name, condition: Boolean(condition) });

check(
  "native warms local route code without mounting hidden ranking data on constrained boot",
  app.includes("const nativeLocalCode = Capacitor.isNativePlatform();") &&
    app.includes("preloadRoleRoutes(activeRole || \"driver\")") &&
    app.includes("if (!runtime.allowRankingWarmup) { setEnabled(false); return; }")
);
check(
  "ranking reuses confirmed snapshots and gates new comparative projections",
  ranking.includes("visibleRankingSnapshot.items.length > 0") &&
    ranking.includes(": preparedLiveRanking ? liveRankingData : []") &&
    ranking.includes("const rankingReady = rankingData.length > 0 || preparedLiveRanking")
);
check(
  "profile chunks hydrate progressively",
  users.includes("Array.from(merged.values())") &&
    users.includes("keeping loading=true until every bounded source settles")
);
check(
  "profile completion remains authoritative",
  users.includes("entry.hasCompleteSnapshot = true") &&
    users.includes("loading: false")
);
check(
  "image decoding is not a visual gate",
  ranking.includes("gateInitialPublishOnImages: false")
);

const failed = checks.filter((item) => !item.condition);
checks.forEach((item) => console.log(`${item.condition ? "PASS" : "FAIL"} ${item.name}`));
if (failed.length) {
  console.error(`Ranking Android first-paint contract failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log(`Ranking Android first-paint contract passed: ${checks.length} checks`);
