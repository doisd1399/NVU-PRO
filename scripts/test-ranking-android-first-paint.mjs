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
  "native boot mounts ranking warmup immediately",
  app.includes("if (Capacitor.isNativePlatform())") &&
    app.includes("enable();") &&
    app.includes("return () => {\n        cancelled = true;\n      };")
);
check(
  "ranking paints live projection before complete sources",
  ranking.includes("visibleRankingSnapshot.items.length > 0") &&
    ranking.includes(": liveRankingData") &&
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
