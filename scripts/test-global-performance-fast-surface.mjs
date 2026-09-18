import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const companyTab = read("src/pages/admin/fleet/CompanyTab.tsx");
const companyCard = read("src/components/CompanyPerformanceCard.tsx");
const driverProfile = read("src/pages/admin/DriverProfileIsolated.tsx");
const ranking = read("src/pages/RankingGlobal.tsx");
const rankingEngine = read("src/lib/rankingPageEngine.ts");
const photoWarmup = read("src/lib/rankingPhotoWarmup.ts");
const driverProfileRoute = read("src/pages/driver/Profile.tsx");
const tripHistoryHook = read("src/hooks/useTripHistory.ts");

assert.equal(companyTab.includes("performanceReady"), false, "CompanyTab não pode manter gate de frame");
assert.equal(companyTab.includes("requestAnimationFrame"), false, "CompanyTab não pode atrasar conteúdo crítico por frame");
assert.equal(
  companyTab.includes("enabled: Boolean(activeCompanyId)"),
  true,
  "histórico da empresa deve iniciar quando o companyId existir",
);
assert.equal(
  companyTab.includes("<CompanyPerformanceCard"),
  true,
  "card da empresa deve montar sem depender do catálogo global",
);
assert.equal(
  companyTab.includes("requestIdleCallback") || companyTab.includes("window.setTimeout(run, 450)"),
  true,
  "catálogo global deve continuar como tarefa secundária",
);

assert.equal(
  companyCard.includes("const normalizedCompanyHistory = useMemo") &&
    companyCard.includes("const hasVisibleCompanyHistory = normalizedCompanyHistory.length > 0"),
  true,
  "CompanyPerformanceCard deve reconhecer histórico válido já disponível",
);
assert.equal(
  companyCard.includes("!hasVisibleCompanyHistory"),
  true,
  "loading de ranking/classificação deve ser somente estado inicial vazio",
);
assert.equal(
  companyCard.includes("companyTripsLoading && currentTrips.length === 0"),
  true,
  "refresh de empresa sem dados ainda pode exibir loading local legítimo",
);

assert.equal(
  driverProfile.includes("enabled: Boolean(viewedCompanyId)"),
  true,
  "perfil de motorista deve manter hidratação imediata por empresa",
);
assert.equal(driverProfile.includes("secondaryReady"), false, "perfil de motorista não pode reintroduzir gate artificial");

assert.equal(
  ranking.includes("gateInitialPublishOnImages: false"),
  true,
  "ranking nunca deve bloquear a primeira pintura aguardando imagens",
);
assert.equal(
  ranking.includes("publish();\n      void preloadRankingSnapshotImages(snapshot);"),
  true,
  "ranking deve publicar dados antes do preload de imagens quando o gate estiver desligado",
);
assert.equal(
  ranking.includes("const rankingData =\n    visibleRankingSnapshot.key === rankingCacheKey"),
  true,
  "ranking deve reutilizar o snapshot em memória da mesma chave",
);
assert.equal(
  ranking.includes("const RankingListItem = memo") &&
    ranking.includes("const RANKING_CRITICAL_IMAGE_LIMIT = 24"),
  true,
  "linhas do ranking devem ser memoizadas e o warmup crítico deve permanecer limitado",
);
assert.equal(
  rankingEngine.includes("tripsAlreadyFilteredBySimulator") &&
    ranking.includes("tripsAlreadyFilteredBySimulator: true"),
  true,
  "o ranking não deve repetir a filtragem canônica de simulador",
);
assert.equal(
  photoWarmup.includes('const PHOTO_MANIFEST_VERSION = "v3"') &&
    photoWarmup.includes("const MAX_RANKING_WARM_URLS = 96"),
  true,
  "manifesto de fotos deve invalidar o warmup amplo antigo e permanecer bounded",
);

assert.equal(
  tripHistoryHook.includes("readTripHistoryCache"),
  true,
  "CompanyTab deve reutilizar o cache persistente existente",
);
assert.equal(
  tripHistoryHook.includes("writeTripHistoryCache"),
  true,
  "reconciliação deve atualizar o cache existente",
);

assert.equal(
  driverProfileRoute.includes("requestIdleCallback") &&
    driverProfileRoute.includes("Driver-owned trips and identity are the critical first paint"),
  true,
  "warmup do catálogo do perfil motorista deve permanecer secundário",
);

console.log(
  "global-performance-fast-surface: PASS CompanyTab, driver profile, cache-first metrics, ranking image policy and secondary warmups",
);
