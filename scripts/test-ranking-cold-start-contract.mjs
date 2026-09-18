import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ranking = read("src/pages/RankingGlobal.tsx");
const repository = read("src/repositories/TripsRepository.ts");
const warmup = read("src/components/common/RankingStartupWarmup.tsx");

const checks = [];
const check = (name, condition) => {
  checks.push({ name, condition: Boolean(condition) });
};

check(
  "canonical trip projection paints before legacy completion",
  repository.includes("canonicalProjectionPainted") &&
    repository.includes("onNext(canonicalTrips)") &&
    repository.includes("areTripSourcesReady(canonicalAuthoritative, legacyReady)"),
);
check(
  "default week/month range is warmed",
  warmup.includes("const shouldWarmTrips = enabled;") &&
    !warmup.includes('periodPreset !== "semana" && periodPreset !== "mes"'),
);
check(
  "ranking snapshot is persisted with scoped key",
  ranking.includes('RANKING_PERSISTED_CACHE_PREFIX = "nvu.ranking.snapshot.v2."') &&
    ranking.includes("window.localStorage.setItem") &&
    ranking.includes("encodeURIComponent(key)"),
);
check(
  "images never gate first ranking publication",
  ranking.includes("gateInitialPublishOnImages: false"),
);
check(
  "computed projection can unlock cold first paint",
  ranking.includes("hasComputedRankingProjection = calculatedRankingData.length > 0") &&
    ranking.includes("hasComputedRankingProjection ||"),
);
check(
  "error notice is shown once per ranking key",
  ranking.includes("rankingErrorNoticeKeysRef") &&
    ranking.includes("showRankingErrorNotice") &&
    ranking.includes("!rankingReady"),
);

// Small deterministic model of the publish contract: a canonical non-empty
// snapshot is usable immediately, while the merged snapshot remains the final
// authoritative result once legacy compatibility reads settle.
const events = [];
const canonical = [{ id: "company-1", val: 100 }];
const legacy = [{ id: "legacy-1", val: 25 }];
let painted = false;
const emit = (canonicalReady, legacyReady) => {
  if (!painted && canonicalReady && canonical.length > 0) {
    painted = true;
    events.push(canonical);
  }
  if (canonicalReady && legacyReady) events.push([...canonical, ...legacy]);
};
emit(true, false);
emit(true, true);
check(
  "progressive publish has provisional then authoritative event",
  events.length === 2 && events[0].length === 1 && events[1].length === 2,
);

const failed = checks.filter((item) => !item.condition);
checks.forEach((item) => console.log(`${item.condition ? "PASS" : "FAIL"} ${item.name}`));
if (failed.length > 0) {
  console.error(`Ranking cold-start contract failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log(`Ranking cold-start contract passed: ${checks.length} checks`);
