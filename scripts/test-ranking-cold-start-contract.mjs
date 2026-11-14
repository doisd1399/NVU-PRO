import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ranking = read("src/pages/RankingGlobal.tsx");
const adapter = read("src/application/trip/CanonicalTripRealtimeFirebaseAdapter.ts");
const queryService = read("src/application/trip/CanonicalTripQueryService.ts");
const hook = read("src/hooks/useTripsRealtime.ts");
const warmup = read("src/components/common/RankingStartupWarmup.tsx");

const checks = [];
const check = (name, condition) => checks.push({ name, condition: Boolean(condition) });

check(
  "canonical source is historico_viagens, never unruled global trips",
  adapter.includes('collection(firestore, "historico_viagens")') &&
    !adapter.includes('collection(firestore, "trips")'),
);
check(
  "company and driver listeners carry explicit authorization predicates",
  adapter.includes('where(companyField, "==", companyId)') &&
    adapter.includes('where(driverField, "==", driverId)') &&
    adapter.includes("CANONICAL_TRIP_READ_SCOPE_REQUIRED"),
);
check(
  "query service scopes company and driver history through the same adapter",
  queryService.includes("listenCanonicalTripsForScope") &&
    queryService.includes("listenCompanyTrips") &&
    queryService.includes("listenDriverTrips"),
);
check(
  "ranking cache key distinguishes authorization scopes",
  hook.includes("requestedScopeKey") && hook.includes("scopedCacheScope") &&
    hook.includes("companyIds"),
);
check(
  "ranking's internal mode queries its selected company",
  ranking.includes("selectedCompanyId || activeCompanyId") &&
    ranking.includes("companyIds:"),
);
check(
  "startup warmup shares the active company's scope",
  warmup.includes("companyId: activeCompanyId || undefined"),
);
check(
  "default week/month range remains warmed",
  warmup.includes("const shouldWarmTrips = enabled;") &&
    !warmup.includes('periodPreset !== "semana" && periodPreset !== "mes"'),
);
check(
  "ranking first paint remains non-blocking for avatars",
  ranking.includes("gateInitialPublishOnImages: false") &&
    ranking.includes("hasComputedRankingProjection = calculatedRankingData.length > 0"),
);
check(
  "unavailable server-owned ranking shows retry without widening private trip reads",
  ranking.includes("showServerRankingUnavailableNotice") &&
    ranking.includes("!globalAggregateUnsupported") &&
    ranking.includes("Não foi possível carregar o ranking.") &&
    ranking.includes("Tentar novamente") &&
    ranking.includes('const useTripFallback = rankingType === "interno"'),
);

const failed = checks.filter((item) => !item.condition);
checks.forEach((item) => console.log(`${item.condition ? "PASS" : "FAIL"} ${item.name}`));
if (failed.length) {
  console.error(`Ranking cold-start contract failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log(`Ranking canonical cold-start contract passed: ${checks.length} checks`);
