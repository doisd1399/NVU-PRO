import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const profile = read("src/pages/admin/DriverProfileIsolated.tsx");
const tripHistory = read("src/hooks/useTripHistory.ts");
const persistentCache = read("src/lib/tripHistoryPersistentCache.ts");
const repository = read("src/repositories/TripsRepository.ts");
const historyPage = read("src/pages/driver/TripHistory.tsx");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const driversTab = read("src/pages/admin/fleet/DriversTab.tsx");

assert.equal(
  profile.includes("enabled: Boolean(viewedCompanyId)") &&
    profile.includes("userId: currentUser?.id"),
  true,
  "perfil deve habilitar histórico assim que a empresa observada existir",
);
assert.equal(
  profile.includes("secondaryReady"),
  false,
  "perfil não pode manter o gate artificial secondaryReady",
);
assert.equal(
  profile.includes("requestAnimationFrame"),
  false,
  "perfil não pode atrasar o histórico com requestAnimationFrame",
);
assert.equal(
  profile.includes("{viewedCompanyId ? (\n              <DriverPerformanceCard"),
  true,
  "card do perfil deve montar sem esperar companyCatalogLoaded",
);
assert.equal(
  profile.includes("secondaryReady && companyCatalogLoaded"),
  false,
  "catálogo global não pode bloquear a primeira pintura do histórico",
);

assert.equal(
  tripHistory.includes("const tripHistoryCache = new Map<string, TripHistoryCacheEntry>()"),
  true,
  "histórico deve reutilizar cache em memória",
);
assert.equal(
  tripHistory.includes("readTripHistoryCache"),
  true,
  "cache persistente deve hidratar o primeiro estado",
);
assert.equal(
  tripHistory.includes("refreshing"),
  true,
  "dados stale devem permanecer visíveis durante sincronização",
);
assert.equal(
  tripHistory.includes("sessionStorage"),
  false,
  "histórico não pode depender de sessionStorage no cold start",
);
assert.equal(
  persistentCache.includes('const CACHE_PREFIX = "nvu.trips.v2:"'),
  true,
  "cache persistente deve usar contrato versionado",
);
assert.equal(
  persistentCache.includes("user:${encodeURIComponent(userId)}:company:${encodeURIComponent(companyId)}"),
  true,
  "cache persistente deve ser escopado por UID e empresa",
);
assert.equal(
  persistentCache.includes("clearTripHistoryCacheForUser"),
  true,
  "logout deve possuir limpeza escopada por UID",
);

assert.equal(
  repository.includes('where("companyId", "==", companyId)'),
  true,
  "listener canônico deve continuar filtrado por empresa",
);
assert.equal(
  repository.includes("loadLegacyTripsOnce({ companyId })"),
  true,
  "aliases legados devem continuar reconciliados",
);
assert.equal(
  repository.includes("areTripSourcesReady(canonicalAuthoritative, legacyReady)"),
  true,
  "a correção não pode publicar dataset parcial",
);
const companyListenerCount = (repository.match(/listenCompanyTrips|onSnapshot\(/g) || []).length;
assert.ok(companyListenerCount >= 2, "repository deve manter listener canônico e contrato de sources");

assert.equal(
  driversTab.includes("useTripHistory(activeCompanyId, {") &&
    driversTab.includes("userId: currentUser?.id"),
  true,
  "lista de motoristas deve aquecer/reutilizar o cache da empresa",
);
assert.equal(
  driversTab.includes("companyId: activeCompanyId"),
  true,
  "navegação deve transportar o escopo da empresa observada",
);
assert.equal(
  profile.includes("defaultDriverId={driver.id}"),
  true,
  "perfil deve passar o filtro explícito por motorista ao histórico dedicado",
);
assert.equal(
  profile.includes("companyId={viewedCompanyId || undefined}"),
  true,
  "perfil deve passar o filtro explícito por empresa ao histórico dedicado",
);
assert.equal(
  historyPage.includes("loading && finalTrips.length === 0"),
  true,
  "loading só pode aparecer quando não existe histórico disponível",
);
assert.equal(
  dashboard.includes("historicoTripsOverride={historicoTrips}"),
  true,
  "Dashboard deve repassar o snapshot já disponível para a seção de viagens",
);
assert.equal(
  dashboard.includes("historyLoadingOverride={tripHistoryLoading}"),
  true,
  "Dashboard deve repassar o estado de sincronização sem apagar o conteúdo",
);
assert.equal(
  historyPage.includes("const hasHistoryOverride = Array.isArray(historicoTripsOverride)"),
  true,
  "TripHistory deve distinguir snapshot recebido de ausência de override",
);
assert.equal(
  historyPage.includes("enabled: !hasHistoryOverride") &&
    historyPage.includes("userId: currentUser?.id"),
  true,
  "TripHistory não deve abrir listener interno quando o Dashboard já possui o snapshot",
);

console.log(
  "driver-history-immediate-load: PASS cache-first, no artificial frame gate, scoped reconciliation and no duplicate history architecture",
);
