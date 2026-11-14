import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundles = [
  "authenticateSeniorAccess_v10",
  "ensureRankingAggregates_v15",
  "registerGtoTrip_v18",
  "syncGtoTripState_v10",
];
const rankingSources = bundles.map((name) => fs.readFileSync(
  path.join(root, "backend_source/source_bundles", name, "src/rankingAggregates.ts"),
  "utf8",
));
const indexSources = bundles.map((name) => fs.readFileSync(
  path.join(root, "backend_source/source_bundles", name, "src/index.ts"),
  "utf8",
));
const seniorPanel = fs.readFileSync(path.join(root, "src/pages/admin/SeniorPanel.tsx"), "utf8");
const seniorService = fs.readFileSync(path.join(root, "src/services/seniorMonthlyMetricsService.ts"), "utf8");
const seniorInvalidation = fs.readFileSync(path.join(root, "src/services/seniorMetricsInvalidationService.ts"), "utf8");
const main = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");

for (const [index, source] of rankingSources.entries()) {
  assert.match(source, /const SCHEMA_VERSION = 4;/, `${bundles[index]} must write schema v4`);
  assert.match(source, /periodTimeZone: RANKING_TIME_ZONE/, "rebuild must persist Sao Paulo timezone");
  assert.match(source, /periodPolicy: RANKING_PERIOD_POLICY/, "rebuild must persist calendar policy");
  assert.match(source, /data\.periodPolicy !== RANKING_PERIOD_POLICY/, "delta trigger must reject incompatible aggregate");
  assert.match(source, /data\.periodPolicy === RANKING_PERIOD_POLICY/, "ensure must rebuild missing/wrong policy");
  assert.match(source, /\.document\("historico_viagens\/\{tripId\}"\)/, "canonical trip trigger missing");
  assert.match(source, /requireSenior\(context, "A claim Sênior é obrigatória/, "metrics callable must validate Senior claim");
  assert.match(source, /\.map\(\(item\) => \(\{\s*companyId: item\.companyId,\s*tripCount: item\.tripCount,\s*earnings:/, "callable must return only company-level count and earnings");
  assert.ok(!source.includes("receiptUrl: item"), "sensitive receipt data must not be returned");
  assert.ok(indexSources[index].includes("getSeniorMonthlyMetrics"), `${bundles[index]} index must export the callable`);
}

assert.ok(!seniorPanel.includes("useTripsRealtime"), "SeniorPanel must not query trip documents for monthly totals");
assert.ok(!seniorPanel.includes("getFilteredTrips"), "SeniorPanel must not derive global monthly totals from client trip records");
assert.match(seniorPanel, /getSeniorMonthlyMetrics\(\)/, "SeniorPanel must use the sanitized callable");
assert.match(seniorPanel, /monthlyEarnings/, "SeniorPanel must display monthly earnings");
assert.match(seniorService, /"getSeniorMonthlyMetrics"/, "client must call the expected HTTPS callable");
assert.match(seniorService, /America\/Sao_Paulo/);
assert.match(seniorService, /SAO_PAULO_CALENDAR/);
assert.match(seniorService, /companyId\?: unknown;[\s\S]*tripCount\?: unknown;[\s\S]*earnings\?: unknown;/);
assert.match(seniorPanel, /registerSeniorMetricsInvalidation\(refreshMetrics\)/, "Senior metrics must refresh after canonical confirmation");
assert.match(seniorPanel, /currentRequestId !== requestId/, "stale metric responses must not overwrite newer refreshes");
assert.match(seniorInvalidation, /onCanonicalTripUpdated/, "Senior refresh must subscribe to canonical trip events");
assert.match(main, /registerCanonicalTripCacheInvalidation\(\)/, "history cache invalidation must be installed during app bootstrap");

console.log(`ETAPA32 CONTRACT PASS (${bundles.length} backend snapshots, Senior Panel callable and data minimization)`);
