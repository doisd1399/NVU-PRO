import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const findings = [];
const add = (severity, code, file, message) =>
  findings.push({ severity, code, file, message });

const tripsRepository = read("src/repositories/TripsRepository.ts");
const appContext = read("src/context/AppContext.tsx");
const appEntry = read("src/App.tsx");
const notificationsContext = read("src/context/NotificationsContext.tsx");
const legacyNotificationsConfig = read("src/config/legacyNotifications.ts");
const notificationService = read("src/services/notificationService.ts");
const userIdentityService = read("src/services/userIdentityService.ts");
const companyContext = read("src/context/CompanyContext.tsx");
const rankingGlobal = read("src/pages/RankingGlobal.tsx");
const rankingWarmup = read("src/components/common/RankingStartupWarmup.tsx");
const recruitmentApply = read("src/pages/RecruitmentApply.tsx");
const recruitmentTab = read("src/pages/admin/fleet/RecruitmentTab.tsx");
const joinCompany = read("src/pages/driver/JoinCompany.tsx");
const newsFeed = read("src/pages/NewsFeed.tsx");
const newsModal = read("src/components/admin/CreateNewsModal.tsx");
const rankingAggregateHook = read("src/hooks/useRankingAggregate.ts");
const rankingCompaniesHook = read("src/hooks/useRankingCompaniesByIds.ts");
const rankingUsersHook = read("src/hooks/useRankingUsersRealtime.ts");
const driverTripsHook = read("src/hooks/useDriverTrips.ts");
const tripHistoryHook = read("src/hooks/useTripHistory.ts");
const tripHistoryPage = read("src/pages/driver/TripHistory.tsx");
const rankingAggregateFunctions = read("functions/src/rankingAggregates.ts");
const nvuNewsBackfillFunctions = read("functions/src/nvuNewsBackfill.ts");
const storageCleanupFunctions = read("functions/src/storageCleanupAudit.ts");
const functionIndex = read("functions/src/index.ts");
const firestoreRules = read("firestore.rules");
const indexes = JSON.parse(read("firestore.indexes.json"));
const packageJson = JSON.parse(read("package.json"));
const metadata = JSON.parse(read("metadata.json"));
const envExample = fs.existsSync(path.join(root, ".env.example"))
  ? read(".env.example")
  : "";
const gtoObserverService = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gtoAutoTripSync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const gtoStateFunctions = read("functions/src/gtoState.ts");
const gtoTripFunctions = read("functions/src/gtoTrips.ts");

if (packageJson.dependencies?.["@google/genai"]) {
  add(
    "critical",
    "UNUSED_GENAI_RUNTIME",
    "package.json",
    "@google/genai foi reintroduzido como dependência de runtime sem necessidade operacional aprovada.",
  );
}

if (JSON.stringify(metadata).toUpperCase().includes("GEMINI")) {
  add(
    "critical",
    "GEMINI_CAPABILITY_METADATA",
    "metadata.json",
    "O projeto voltou a anunciar capacidade Gemini sem fluxo de IA aprovado para produção.",
  );
}

if (/GEMINI_API_KEY/i.test(envExample)) {
  add(
    "critical",
    "GEMINI_ENV_WIRING",
    ".env.example",
    "Foi detectado wiring de GEMINI_API_KEY; IA paga não deve ser ativada implicitamente no NVU.",
  );
}

if (
  !gtoAutoTripSync.includes("Autenticação NVU ausente para sincronizar estado GTO") ||
  !gtoAutoTripSync.includes("GtoFirebaseRuntime.currentUser(context)")
) {
  add(
    "critical",
    "GTO_CANONICAL_AUTH_GATE",
    "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java",
    "O espelhamento canônico GTO pode chamar Firebase Functions sem validar autenticação nativa local primeiro.",
  );
}

if (
  !gtoObserverService.includes("CANONICAL_SYNC_BASE_RETRY_MS = 15_000L") ||
  !gtoObserverService.includes("CANONICAL_SYNC_MAX_RETRY_MS = 5L * 60_000L") ||
  !gtoObserverService.includes("isPermanentCanonicalSyncFailure") ||
  gtoObserverService.includes("mainHandler.postDelayed(this::retryCanonicalStateSync, 5000L)") ||
  gtoObserverService.includes("mainHandler.postDelayed(() -> retryCanonicalStateSync(), 2500L)")
) {
  add(
    "critical",
    "GTO_CANONICAL_RETRY_STORM",
    "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
    "A proteção HF58 contra retry infinito/rápido de syncGtoTripState não está íntegra.",
  );
}

if (
  !gtoAutoTripSync.includes("shouldPauseAutomaticRetry") ||
  !gtoAutoTripSync.includes("RETRY_BLOCK_CODE_PREFIX") ||
  !gtoAutoTripSync.includes("Long.MAX_VALUE") ||
  !gtoAutoTripSync.includes("FirebaseFunctionsException.Code.INVALID_ARGUMENT") ||
  !gtoAutoTripSync.includes("FirebaseFunctionsException.Code.FAILED_PRECONDITION") ||
  !gtoAutoTripSync.includes("FirebaseFunctionsException.Code.PERMISSION_DENIED") ||
  !gtoAutoTripSync.includes("FirebaseFunctionsException.Code.UNAUTHENTICATED")
) {
  add(
    "critical",
    "GTO_TRIP_PERMANENT_RETRY_STORM",
    "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java",
    "A proteção HF59 contra retry infinito de registerGtoTrip em erros permanentes não está íntegra.",
  );
}

if (
  !gtoAutoTripSync.includes('pauseRetryForReason(retry, queuedSessionId, "NO_NATIVE_AUTH")') ||
  !gtoAutoTripSync.includes('pauseRetryForReason(retry, sessionId, "DRIVER_UID_MISMATCH")') ||
  !gtoAutoTripSync.includes('pauseRetryForReason(retry, sessionId, "BACKEND_CONTRACT_MISMATCH")') ||
  !gtoAutoTripSync.includes("AUTH_RECOVERY_RELEASED.add(sessionId + \":\" + blockedCode)") ||
  !gtoAutoTripSync.includes("AUTH_RECOVERY_RELEASED.add(recoveryKey)") ||
  !gtoAutoTripSync.includes("blockReason.equals(existingReason) && existingRetryAt == Long.MAX_VALUE") ||
  !gtoAutoTripSync.includes("if (listener != null && pauseChanged)")
) {
  add(
    "critical",
    "GTO_TRIP_LOCAL_RETRY_GATES",
    "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java",
    "A fila durável perdeu as contenções locais HF59 para autenticação, ownership ou contrato inválido.",
  );
}

if (
  !gtoObserverService.includes("COMPLETION_QUEUE_SEAL_RETRY_BASE_MS = 1_200L") ||
  !gtoObserverService.includes("COMPLETION_QUEUE_SEAL_RETRY_MAX_MS = 60_000L") ||
  !gtoObserverService.includes("recoverUnsealedCompletedTripIfNeeded(now);") ||
  !gtoObserverService.includes("armCompletionQueueSealRecovery(completedSessionId, System.currentTimeMillis())") ||
  !gtoObserverService.includes('"QUEUE_SEAL_PENDING"') ||
  !gtoObserverService.includes("protegendo o registro local")
) {
  add(
    "critical",
    "GTO_COMPLETION_QUEUE_SEAL_RECOVERY",
    "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
    "A autorrecuperação HF59 entre resultado certificado e fila durável não está íntegra.",
  );
}

const sameStateIndex = gtoStateFunctions.indexOf("currentSnap.exists && currentState === state");
const expectedStateIndex = gtoStateFunctions.indexOf("expectedState && expectedState !== currentState");
if (sameStateIndex < 0 || expectedStateIndex < 0 || sameStateIndex > expectedStateIndex) {
  add(
    "critical",
    "GTO_CANONICAL_IDEMPOTENCY",
    "functions/src/gtoState.ts",
    "Retry de uma transição canônica já confirmada pode voltar a gerar conflito e novas invocações.",
  );
}

if (
  !gtoTripFunctions.includes("GTO_PROGRESS_SCHEMA_VERSION = 1") ||
  !gtoTripFunctions.includes("progressFastPath") ||
  !gtoTripFunctions.includes("gtoProgressSchemaVersion: GTO_PROGRESS_SCHEMA_VERSION") ||
  !gtoTripFunctions.includes("transaction.set(jobRef, progressUpdate, { merge: true })")
) {
  add(
    "critical",
    "GTO_PROGRESS_INCREMENTAL_COST_GUARD",
    "functions/src/gtoTrips.ts",
    "O registro GTO perdeu a migração segura que evita reler todas as viagens a cada novo envio.",
  );
}

const unboundedTripRead = /(?:getDocs|getDocsFromServer|onSnapshot)\s*\(\s*collection\(db,\s*["']historico_viagens["']\s*\)/m;
if (unboundedTripRead.test(tripsRepository)) {
  add(
    "critical",
    "TRIPS_GLOBAL_READ",
    "src/repositories/TripsRepository.ts",
    "Existe leitura/listener direto da coleção historico_viagens sem query explícita.",
  );
}

if (!tripsRepository.includes("Leitura legada sem companyId/driverId bloqueada")) {
  add(
    "critical",
    "LEGACY_SCOPE_GUARD",
    "src/repositories/TripsRepository.ts",
    "A proteção contra carregamento legado sem companyId/driverId não foi encontrada.",
  );
}

if (!tripsRepository.includes("Promise.allSettled")) {
  add(
    "warning",
    "LEGACY_PARTIAL_FAILURE",
    "src/repositories/TripsRepository.ts",
    "Consultas de aliases legados não estão protegidas contra falha parcial.",
  );
}

if (/onSnapshot\s*\(\s*collection\(db,\s*["']frotas["']\s*\)/m.test(appContext)) {
  add(
    "critical",
    "FROTAS_GLOBAL_LISTENER",
    "src/context/AppContext.tsx",
    "Listener permanente da coleção completa frotas foi reintroduzido.",
  );
}

if (
  /getDocs\s*\(\s*collection\(db,\s*["']frotas["']\s*\)/m.test(appContext) &&
  !appContext.includes("PUBLIC_COMPANY_CATALOG_ON_DEMAND")
) {
  add(
    "warning",
    "FROTAS_BOOT_CATALOG",
    "src/context/AppContext.tsx",
    "O catálogo completo de frotas ainda é lido uma vez no boot; rankings e recrutamento dependem dele.",
  );
}

if (
  !companyContext.includes("PUBLIC_COMPANY_CATALOG_ON_DEMAND") ||
  !companyContext.includes("loadCompanyCatalog") ||
  !companyContext.includes("companyCatalogLoaded")
) {
  add(
    "critical",
    "FROTAS_ON_DEMAND_LOADER",
    "src/context/AppContext.tsx",
    "O carregador sob demanda do catálogo público de frotas não foi encontrado.",
  );
}

for (const [file, source] of [
  ["src/pages/RecruitmentApply.tsx", recruitmentApply],
  ["src/pages/driver/JoinCompany.tsx", joinCompany],
  ["src/pages/NewsFeed.tsx", newsFeed],
]) {
  if (!source.includes("loadCompanyCatalog")) {
    add(
      "warning",
      "FROTAS_COLLECTIVE_PAGE_LOAD",
      file,
      "Página coletiva não solicita explicitamente o catálogo de empresas.",
    );
  }
}

if (
  !rankingGlobal.includes("useRankingCompaniesByIds") ||
  !rankingGlobal.includes("effectiveTripFallback")
) {
  add(
    "critical",
    "RANKING_SCOPED_COMPANIES",
    "src/pages/RankingGlobal.tsx",
    "O ranking não demonstra consulta apenas às empresas do agregado com catálogo completo restrito ao fallback.",
  );
}

if (
  !rankingCompaniesHook.includes("FIRESTORE_IN_LIMIT = 30") ||
  !rankingCompaniesHook.includes('where(documentId(), "in", ids)') ||
  !rankingCompaniesHook.includes("getDocs") ||
  rankingCompaniesHook.includes("onSnapshot")
) {
  add(
    "critical",
    "RANKING_COMPANY_BATCH_LOADER",
    "src/hooks/useRankingCompaniesByIds.ts",
    "O carregador de empresas do ranking não está limitado por IDs em lotes ou reintroduziu listener permanente.",
  );
}


if (
  !rankingUsersHook.includes("failedSources.size > 0") ||
  !rankingUsersHook.includes("scheduleRetry(entry)") ||
  !rankingUsersHook.includes("RETRY_MAX_DELAY_MS")
) {
  add(
    "critical",
    "RANKING_USERS_PARTIAL_CACHE",
    "src/hooks/useRankingUsersRealtime.ts",
    "Falha de um lote de perfis do ranking pode ser promovida a snapshot completo ou ficar sem retry limitado.",
  );
}

if (
  !rankingCompaniesHook.includes("RETRY_MAX_DELAY_MS") ||
  !rankingCompaniesHook.includes("scheduleRetry(entry)") ||
  !rankingCompaniesHook.includes("1_500 * 2 ** entry.retryAttempt")
) {
  add(
    "warning",
    "RANKING_COMPANY_RETRY_BACKOFF",
    "src/hooks/useRankingCompaniesByIds.ts",
    "A confirmação de empresas do ranking não demonstra backoff exponencial limitado.",
  );
}

if (
  !driverTripsHook.includes("entry.subscribers.size === 0") ||
  !tripHistoryHook.includes("entry.listeners.size === 0")
) {
  add(
    "warning",
    "HISTORY_RETRY_AFTER_UNMOUNT",
    "src/hooks/useDriverTrips.ts",
    "Retries de histórico podem continuar consultando o Firestore depois que a tela ficou sem consumidores.",
  );
}

if (
  tripHistoryPage.includes("TripsRepository.runBackfill(activeCompanyId)") &&
  !tripHistoryPage.includes("needsLegacyEnrichment")
) {
  add(
    "warning",
    "TRIP_BACKFILL_UNNECESSARY_SCAN",
    "src/pages/driver/TripHistory.tsx",
    "O backfill legado pode varrer viagens no servidor em toda sessão mesmo quando os registros já estão enriquecidos.",
  );
}

if (!rankingGlobal.includes('const ALL_SIMULATORS_VALUE = "all"')) {
  add(
    "critical",
    "RANKING_ALL_CONSTANT",
    "src/pages/RankingGlobal.tsx",
    "A constante ALL_SIMULATORS_VALUE não está declarada localmente.",
  );
}

if (!rankingGlobal.includes("rankingType") || !rankingGlobal.includes("simulator")) {
  add(
    "critical",
    "RANKING_CACHE_SCOPE",
    "src/pages/RankingGlobal.tsx",
    "A chave de cache do ranking não demonstra escopo por tipo e simulador.",
  );
}

if (!rankingWarmup.includes("useTripsRealtime")) {
  add(
    "warning",
    "RANKING_WARMUP",
    "src/components/common/RankingStartupWarmup.tsx",
    "O aquecimento compartilhado do ranking não foi encontrado.",
  );
}

if (
  !rankingGlobal.includes("useRankingAggregate") ||
  !(rankingGlobal.includes("enabled: useTripFallback") ||
    rankingGlobal.includes("enabled: effectiveTripFallback"))
) {
  add(
    "critical",
    "RANKING_AGGREGATE_CLIENT",
    "src/pages/RankingGlobal.tsx",
    "O ranking semanal/mensal não está priorizando o documento consolidado com fallback seguro.",
  );
}

if (
  !rankingAggregateHook.includes("MISSING_AGGREGATE_FALLBACK_MS") ||
  !rankingAggregateHook.includes("ensureRankingAggregate")
) {
  add(
    "critical",
    "RANKING_AGGREGATE_FALLBACK",
    "src/hooks/useRankingAggregate.ts",
    "A consolidação não possui timeout e fallback para o cálculo estável por viagens.",
  );
}

if (!rankingWarmup.includes("shouldWarmTrips")) {
  add(
    "warning",
    "RANKING_AGGREGATE_WARMUP",
    "src/components/common/RankingStartupWarmup.tsx",
    "O warm-up ainda pode abrir o listener de viagens para rankings semanais/mensais consolidados.",
  );
}

if (
  !rankingAggregateFunctions.includes("where(field, \">=\"") ||
  !rankingAggregateFunctions.includes("PAGE_SIZE") ||
  !rankingAggregateFunctions.includes("updateRankingAggregatesOnTripWrite")
) {
  add(
    "critical",
    "RANKING_AGGREGATE_SERVER",
    "functions/src/rankingAggregates.ts",
    "A geração server-side não demonstra consulta limitada por período, paginação e atualização incremental.",
  );
}

if (
  !rankingAggregateFunctions.includes("RANKING_CHECKPOINT_VERSION") ||
  !rankingAggregateFunctions.includes("checkpointStage") ||
  !rankingAggregateFunctions.includes("FAILED_RETRY_COOLDOWN_MS")
) {
  add(
    "critical",
    "RANKING_PERSISTENT_CHECKPOINT",
    "functions/src/rankingAggregates.ts",
    "A reconstrução de ranking não possui checkpoint persistente e contenção de novas tentativas após falha.",
  );
}

if (
  !nvuNewsBackfillFunctions.includes("HISTORY_CHECKPOINT_VERSION") ||
  !nvuNewsBackfillFunctions.includes("saveHistoryCheckpoint") ||
  !nvuNewsBackfillFunctions.includes("classifications_written") ||
  !nvuNewsBackfillFunctions.includes("communications_migrated")
) {
  add(
    "critical",
    "NVU_NEWS_PERSISTENT_CHECKPOINT",
    "functions/src/nvuNewsBackfill.ts",
    "O backfill do NVU News não demonstra retomada por etapas persistentes.",
  );
}

if (
  !functionIndex.includes("ensureRankingAggregates") ||
  !functionIndex.includes("updateRankingAggregatesOnTripWrite")
) {
  add(
    "critical",
    "RANKING_AGGREGATE_EXPORTS",
    "functions/src/index.ts",
    "As Cloud Functions de ranking consolidado não estão exportadas.",
  );
}

if (!firestoreRules.includes("match /ranking_aggregates/{aggregateId}")) {
  add(
    "critical",
    "RANKING_AGGREGATE_RULES",
    "firestore.rules",
    "A coleção consolidada não possui regra explícita de leitura e ausência de concessão própria de escrita.",
  );
}

if (/onSnapshot\s*\(\s*collection\(db,\s*["']nvu_comunicados["']\s*\)/m.test(newsModal)) {
  add(
    "critical",
    "COMMUNICATIONS_ADMIN_LISTENER",
    "src/components/admin/CreateNewsModal.tsx",
    "O listener completo de comunicados foi reintroduzido no modal administrativo.",
  );
}

if (!newsModal.includes("COMMUNICATIONS_PAGE_SIZE") || !newsModal.includes("startAfter")) {
  add(
    "warning",
    "COMMUNICATIONS_ADMIN_PAGINATION",
    "src/components/admin/CreateNewsModal.tsx",
    "A paginação sob demanda dos comunicados administrativos não foi encontrada.",
  );
}


if (
  !notificationsContext.includes("MAX_LIVE_NOTIFICATIONS") ||
  !notificationsContext.includes('where("read", "==", false)') ||
  !notificationsContext.includes("MAX_LEGACY_NOTIFICATIONS")
) {
  add(
    "warning",
    "NOTIFICATION_BOUNDED_READS",
    "src/context/NotificationsContext.tsx",
    "As consultas de notificações não demonstram limite e preferência por documentos não lidos.",
  );
}

if (
  !legacyNotificationsConfig.includes("readHistory:") ||
  !legacyNotificationsConfig.includes("listenRealtime:") ||
  !legacyNotificationsConfig.includes("writeFallback:") ||
  !legacyNotificationsConfig.includes("resolveLegacy:") ||
  !legacyNotificationsConfig.includes("defaultValue = true")
) {
  add(
    "critical",
    "LEGACY_NOTIFICATION_COMPATIBILITY_FLAGS",
    "src/config/legacyNotifications.ts",
    "Os controles graduais do legado não foram encontrados ou não preservam compatibilidade por padrão.",
  );
}

if (
  !notificationsContext.includes("legacyNotificationCompatibility.readHistory") ||
  !notificationsContext.includes("legacyNotificationCompatibility.listenRealtime") ||
  !notificationsContext.includes("requiredSources")
) {
  add(
    "critical",
    "LEGACY_NOTIFICATION_READ_GUARDS",
    "src/context/NotificationsContext.tsx",
    "As leituras do legado não estão isoladas por controles graduais ou a hidratação ainda depende sempre da coleção antiga.",
  );
}

if (
  !notificationService.includes("legacyFallbackEnabled: legacyNotificationCompatibility.writeFallback") ||
  !notificationService.includes("legacyNotificationCompatibility.resolveLegacy") ||
  !userIdentityService.includes("legacyNotificationCompatibility.resolveLegacy")
) {
  add(
    "critical",
    "LEGACY_NOTIFICATION_WRITE_GUARDS",
    "src/services/notificationService.ts",
    "Fallback de escrita, resolução ou migração do legado não estão controlados pela configuração gradual.",
  );
}

if (
  !functionIndex.includes("ENABLE_LEGACY_NOTIFICATION_PUSH") ||
  !functionIndex.includes("LEGACY_NOTIFICATION_PUSH_ENABLED")
) {
  add(
    "warning",
    "LEGACY_NOTIFICATION_PUSH_GUARD",
    "functions/src/index.ts",
    "O gatilho de push legado não possui chave de desativação gradual.",
  );
}

if (
  /collection\(db,\s*["'](?:notifications|notificacoes)["']\)/m.test(appContext) ||
  !appContext.includes("<NotificationsProvider")
) {
  add(
    "warning",
    "NOTIFICATION_CONTEXT_EXTRACTION",
    "src/context/AppContext.tsx",
    "A lógica de leitura de notificações ainda parece acoplada ao AppContext ou o provider dedicado não foi encontrado.",
  );
}

if (
  appContext.includes("setNotifications(") ||
  appContext.includes("setNotificationsHydrated(")
) {
  add(
    "critical",
    "NOTIFICATION_STALE_SETTERS",
    "src/context/AppContext.tsx",
    "O AppContext ainda chama setters que pertencem ao NotificationsContext extraído.",
  );
}

if (
  !appContext.includes("<CompanyProvider") ||
  !companyContext.includes("useCompanyStore") ||
  !companyContext.includes("CompanyStoreType") ||
  !companyContext.includes("useCompanyDataController") ||
  !companyContext.includes("useCompanyMembersController") ||
  !companyContext.includes("useCompanyRecruitmentController")
) {
  add(
    "critical",
    "COMPANY_CONTEXT_EXTRACTION",
    "src/context/CompanyContext.tsx",
    "O contexto dedicado não possui os controladores de catálogo, membros e recrutamento.",
  );
}

if (
  /getDocs\s*\(\s*collection\(db,\s*["']frotas["']\s*\)/m.test(appContext) ||
  /onSnapshot\s*\(\s*doc\(db,\s*["']frotas["']/m.test(appContext) ||
  appContext.includes("unsubAllCompanyMembers") ||
  appContext.includes("Error fetching all company members") ||
  /onSnapshot\s*\([\s\S]{0,250}collection\(db,\s*["']solicitacoes_motoristas["']/m.test(appContext)
) {
  add(
    "critical",
    "COMPANY_CONTEXT_DUPLICATE_READS",
    "src/context/AppContext.tsx",
    "Leituras/listeners de empresa, membros ou recrutamento ainda permanecem duplicados no AppContext.",
  );
}

if (
  !companyContext.includes("PUBLIC_COMPANY_CATALOG_ON_DEMAND") ||
  !companyContext.includes('onSnapshot(\n      doc(db, "frotas", companyId)') ||
  !companyContext.includes('collection(db, "solicitacoes_motoristas")') ||
  !companyContext.includes('collection(db, "recruitment_applications")')
) {
  add(
    "critical",
    "COMPANY_CONTEXT_LISTENER_OWNER",
    "src/context/CompanyContext.tsx",
    "O CompanyContext não demonstra ser o proprietário único dos carregamentos segmentados.",
  );
}

for (const file of [
  "src/App.tsx",
  "src/layouts/AdminLayout.tsx",
  "src/layouts/DriverLayout.tsx",
  "src/components/common/RankingStartupWarmup.tsx",
  "src/pages/NewsFeed.tsx",
  "src/pages/RankingGlobal.tsx",
  "src/pages/RecruitmentApply.tsx",
  "src/pages/ApplicationStatus.tsx",
  "src/pages/driver/JoinCompany.tsx",
  "src/pages/driver/Dashboard.tsx",
  "src/pages/driver/Profile.tsx",
  "src/pages/driver/RecordTrip.tsx",
  "src/pages/driver/TripHistory.tsx",
  "src/pages/admin/DriverProfileIsolated.tsx",
  "src/pages/admin/SeniorPanel.tsx",
  "src/pages/admin/fleet/RecruitmentTab.tsx",
  "src/pages/admin/fleet/CompanyTab.tsx",
  "src/pages/admin/fleet/DriversTab.tsx",
]) {
  const source = read(file);
  if (!source.includes("useCompanyStore")) {
    add(
      "warning",
      "COMPANY_CONTEXT_CONSUMER",
      file,
      "A tela que consome dados de empresa/recrutamento ainda não utiliza o contexto dedicado.",
    );
  }
}

const sessionStoreBlock = appContext.slice(
  appContext.indexOf("export interface SessionStoreType"),
  appContext.indexOf("export interface ActivityStoreType"),
);
const operationalStoreBlock = appContext.slice(
  appContext.indexOf("export type OperationalStoreType"),
  appContext.indexOf("const SessionContext"),
);
if (
  sessionStoreBlock.includes("companies:") ||
  sessionStoreBlock.includes("loadCompanyCatalog") ||
  operationalStoreBlock.includes("allCompanyMembers") ||
  operationalStoreBlock.includes("createCompany") ||
  operationalStoreBlock.includes("removeDriverFromFleet")
) {
  add(
    "warning",
    "COMPANY_CONTEXT_ADAPTER_REMAINS",
    "src/context/AppContext.tsx",
    "SessionContext ou OperationalContext ainda expõe dados/ações que pertencem ao CompanyContext.",
  );
}

if (
  appContext.includes("AppContextCompatibilityProvider") ||
  appContext.includes("appContextBaseValue") ||
  appContext.includes("createContext<AppContextType") ||
  appContext.includes("export const useAppStore")
) {
  add(
    "critical",
    "MONOLITHIC_CONTEXT_ADAPTER",
    "src/context/AppContext.tsx",
    "O adaptador runtime do antigo AppContext monolítico ainda está ativo.",
  );
}

if (
  companyContext.includes("AppContextType") ||
  companyContext.includes("Pick<\n  AppContextType")
) {
  add(
    "warning",
    "COMPANY_CONTEXT_TYPE_COUPLING",
    "src/context/CompanyContext.tsx",
    "O contrato do CompanyContext ainda depende do tipo monolítico AppContextType.",
  );
}

if (
  appEntry.includes("useAppStore") ||
  !appEntry.includes("useOperationalStore")
) {
  add(
    "critical",
    "APP_ENTRY_LEGACY_CONTEXT",
    "src/App.tsx",
    "As migrações de inicialização ainda consomem o contexto monolítico em vez do OperationalContext.",
  );
}

if (
  appContext.includes('export type { AppNotification }') ||
  appContext.includes("useNotificationStore =")
) {
  add(
    "warning",
    "NOTIFICATION_CONTEXT_ADAPTER_REMAINS",
    "src/context/AppContext.tsx",
    "Ainda existe reexportação de notificações pelo AppContext em vez do módulo dedicado.",
  );
}

if (
  !notificationsContext.includes("unsubscribeModern()") ||
  !notificationsContext.includes("unsubscribeLegacyLive()") ||
  !notificationsContext.includes("subscriptionGenerationRef")
) {
  add(
    "warning",
    "NOTIFICATION_LISTENER_CLEANUP",
    "src/context/NotificationsContext.tsx",
    "A limpeza dos listeners ou a proteção contra respostas de sessão antiga não foi encontrada.",
  );
}

if (
  !companyContext.includes('where("status", "==", "pending")') ||
  !companyContext.includes("MAX_PENDING_REQUESTS")
) {
  add(
    "warning",
    "PENDING_QUEUE_LIMITS",
    "src/context/AppContext.tsx",
    "Filas de solicitações/candidaturas não demonstram escopo somente pendente com limite.",
  );
}

if (
  !recruitmentTab.includes("RECRUITMENT_HISTORY_PAGE_SIZE") ||
  !recruitmentTab.includes("startAfter") ||
  !recruitmentTab.includes("Carregar mais histórico")
) {
  add(
    "warning",
    "RECRUITMENT_HISTORY_PAGINATION",
    "src/pages/admin/fleet/RecruitmentTab.tsx",
    "O histórico de candidaturas não demonstra paginação por cursor e carregamento sob demanda.",
  );
}

const hasLegacyNotificationIndex = Array.isArray(indexes.indexes) &&
  indexes.indexes.some((index) =>
    index.collectionGroup === "notificacoes" &&
    Array.isArray(index.fields) &&
    index.fields.some((field) => field.fieldPath === "userId") &&
    index.fields.some((field) => field.fieldPath === "createdAt"),
  );
if (!hasLegacyNotificationIndex) {
  add(
    "critical",
    "LEGACY_NOTIFICATION_INDEX",
    "firestore.indexes.json",
    "Índice de notificacoes por userId/createdAt não foi encontrado.",
  );
}


const hasRecruitmentHistoryIndex = Array.isArray(indexes.indexes) &&
  indexes.indexes.some((index) =>
    index.collectionGroup === "recruitment_applications" &&
    Array.isArray(index.fields) &&
    index.fields.some((field) => field.fieldPath === "companyId") &&
    index.fields.some(
      (field) => field.fieldPath === "createdAt" && field.order === "DESCENDING",
    ),
  );
if (!hasRecruitmentHistoryIndex) {
  add(
    "warning",
    "RECRUITMENT_HISTORY_INDEX",
    "firestore.indexes.json",
    "Índice de recruitment_applications por companyId/createdAt DESC não foi encontrado.",
  );
}


if (
  !storageCleanupFunctions.includes('CANDIDATES_COLLECTION = "storage_cleanup_candidates"') ||
  !storageCleanupFunctions.includes('mode: "dry_run"') ||
  !storageCleanupFunctions.includes("deletionEnabled: false") ||
  !storageCleanupFunctions.includes("RETENTION_DAYS = 30")
) {
  add(
    "critical",
    "STORAGE_CLEANUP_DRY_RUN",
    "functions/src/storageCleanupAudit.ts",
    "A auditoria de imagens órfãs não está explicitamente restrita ao modo dry-run com retenção e exclusão desativada.",
  );
}

if (
  !storageCleanupFunctions.includes('.document("users/{documentId}")') ||
  !storageCleanupFunctions.includes('.document("frotas/{documentId}")') ||
  !storageCleanupFunctions.includes("onUpdate") ||
  !storageCleanupFunctions.includes("onDelete")
) {
  add(
    "critical",
    "STORAGE_CLEANUP_TRIGGERS",
    "functions/src/storageCleanupAudit.ts",
    "Os gatilhos de auditoria para alterações e exclusões de users/frotas não foram encontrados.",
  );
}

if (
  /\.file\([^)]*\)\.delete\s*\(/m.test(storageCleanupFunctions) ||
  /deleteObject\s*\(/m.test(storageCleanupFunctions)
) {
  add(
    "critical",
    "STORAGE_CLEANUP_DELETION_ENABLED",
    "functions/src/storageCleanupAudit.ts",
    "Foi detectada uma operação real de exclusão no Storage durante a etapa dry-run.",
  );
}

if (
  !storageCleanupFunctions.includes("URLs externas e imagens padrão nunca entram") ||
  !storageCleanupFunctions.includes("isAllowedBucket") ||
  !storageCleanupFunctions.includes("cancelled_referenced_again")
) {
  add(
    "warning",
    "STORAGE_CLEANUP_SAFETY_GUARDS",
    "functions/src/storageCleanupAudit.ts",
    "A auditoria não demonstra todas as proteções contra bucket externo, imagens padrão e reutilização posterior.",
  );
}

if (
  !functionIndex.includes("auditUserStorageImagesOnUpdate") ||
  !functionIndex.includes("auditCompanyStorageImagesOnUpdate") ||
  !functionIndex.includes("auditUserStorageImagesOnDelete") ||
  !functionIndex.includes("auditCompanyStorageImagesOnDelete")
) {
  add(
    "critical",
    "STORAGE_CLEANUP_EXPORTS",
    "functions/src/index.ts",
    "As Cloud Functions de auditoria de imagens não estão exportadas.",
  );
}

if (
  !firestoreRules.includes("match /storage_cleanup_candidates/{candidateId}") ||
  !firestoreRules.includes("allow read, write: if false")
) {
  add(
    "critical",
    "STORAGE_CLEANUP_RULES",
    "firestore.rules",
    "A coleção de candidatos à limpeza não está explicitamente bloqueada para clientes.",
  );
}

const critical = findings.filter((finding) => finding.severity === "critical");
const warnings = findings.filter((finding) => finding.severity === "warning");

console.log("NVU — auditoria estática de custos e regressões");
console.log(`Críticos: ${critical.length} | Avisos: ${warnings.length}`);
for (const finding of findings) {
  const label = finding.severity === "critical" ? "ERRO" : "AVISO";
  console.log(`[${label}] ${finding.code} — ${finding.file}`);
  console.log(`  ${finding.message}`);
}

if (critical.length === 0) {
  console.log("Resultado: aprovado sem regressões críticas detectadas.");
} else {
  console.error("Resultado: reprovado; corrija os itens críticos antes do deploy.");
  process.exitCode = 1;
}
