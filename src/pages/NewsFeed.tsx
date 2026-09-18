import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  DocumentData,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryConstraint,
  QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { preloadImages } from "../lib/imageCache";
import NewsFeedView from "./NewsFeedView";
import { useOperationalStore, useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import { getRuntimePerformanceProfile } from "../lib/runtimePerformance";
import { isRankingPeriodClosed } from "../lib/rankingPeriods";

const PAGE_SIZE = 10;
const SEARCH_LIMIT = 30;
const UNREAD_SCAN_LIMIT = 100;
const UNREAD_REFRESH_MIN_INTERVAL_MS = 2 * 60 * 1000;
const NEWS_CACHE_VERSION = "nvu_news_feed_v10_consistent_metrics";
const NEWS_SCROLL_VERSION = "nvu_news_scroll_v1";
const NEWS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NEWS_CACHE_FRESH_MS = 2 * 60 * 1000;
const NEWS_CACHE_MAX_ENTRIES = 12;
const COLLECTIONS = {
  noticias: "nvu_classificacoes",
  comunicados: "nvu_comunicados",
} as const;

type Section = keyof typeof COLLECTIONS;
type PeriodFilter = "all" | "semana" | "mes";
type RankingEntity = "empresa" | "motorista";

type RankingCompany = {
  posicao: number;
  id: string;
  nome: string;
  logo?: string;
  ganhos: number;
  viagens: number;
};

type RankingDriver = {
  posicao: number;
  id: string;
  nome: string;
  foto?: string;
  empresaId?: string;
  empresaNome?: string;
  empresaLogo?: string;
  ganhos: number;
  viagens: number;
};

type FeedPost = {
  id: string;
  tipo: "classificacao" | "comunicado" | string;
  entidade?: RankingEntity;
  titulo: string;
  legenda?: string;
  mensagem?: string;
  simulador?: string;
  simuladorId?: string;
  simuladorKey?: string;
  simuladorAliases?: string[];
  periodo?: string;
  periodoTipo?: "semana" | "mes";
  periodicidade?: "semana" | "mes";
  historico?: boolean;
  origem?: string;
  topEmpresas?: RankingCompany[];
  topMotoristas?: RankingDriver[];
  empresaId?: string;
  empresaNome?: string;
  empresaLogo?: string;
  proprietarioId?: string;
  proprietarioNome?: string;
  proprietarioFoto?: string;
  publishedAt?: unknown;
  published_at?: unknown;
  publicadoEm?: unknown;
  dataPublicacao?: unknown;
  approvedAt?: unknown;
  updatedAt?: unknown;
  sortAt?: unknown;
  dataReferencia?: unknown;
  createdAt?: unknown;
  status?: string;
  [key: string]: unknown;
};

type SimulatorOption = {
  value: string;
  label: string;
  aliases: string[];
};

type CachedFeed = {
  savedAt: number;
  posts: FeedPost[];
  hasMore: boolean;
};

type FeedCursor = QueryDocumentSnapshot<DocumentData> | null;

type PrefetchedPage = {
  posts: FeedPost[];
  cursor: FeedCursor;
  hasMore: boolean;
};

const memoryFeedCache = new Map<string, CachedFeed>();
const memoryFeedCursors = new Map<string, FeedCursor>();
const newsWarmupInFlight = new Map<string, Promise<void>>();

function feedCacheStorageKey(key: string): string {
  return `${NEWS_CACHE_VERSION}:${key}`;
}

function feedScrollStorageKey(userId: string, key: string): string {
  return `${NEWS_SCROLL_VERSION}:${userId}:${key}`;
}

function readFeedScrollPosition(userId: string, key: string): number {
  if (typeof window === "undefined") return 0;
  const value = Number(
    window.sessionStorage.getItem(feedScrollStorageKey(userId, key)) || 0,
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function writeFeedScrollPosition(userId: string, key: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      feedScrollStorageKey(userId, key),
      String(Math.max(0, Math.round(value))),
    );
  } catch {
    // Session storage is best-effort only.
  }
}

function readFeedCache(key: string): CachedFeed | null {
  const memory = memoryFeedCache.get(key);
  if (memory && Date.now() - memory.savedAt <= NEWS_CACHE_MAX_AGE_MS) return memory;
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(feedCacheStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFeed;
    if (!Array.isArray(parsed?.posts) || !Number.isFinite(parsed?.savedAt)) return null;
    if (Date.now() - parsed.savedAt > NEWS_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(feedCacheStorageKey(key));
      return null;
    }
    memoryFeedCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeFeedCache(key: string, value: CachedFeed): void {
  memoryFeedCache.set(key, value);
  if (memoryFeedCache.size > NEWS_CACHE_MAX_ENTRIES) {
    Array.from(memoryFeedCache.entries())
      .sort((left, right) => right[1].savedAt - left[1].savedAt)
      .slice(NEWS_CACHE_MAX_ENTRIES)
      .forEach(([cacheKey]) => {
        memoryFeedCache.delete(cacheKey);
        memoryFeedCursors.delete(cacheKey);
      });
  }
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(feedCacheStorageKey(key), JSON.stringify(value));
    const entries = Object.keys(localStorage)
      .filter((storageKey) => storageKey.startsWith(`${NEWS_CACHE_VERSION}:`))
      .map((storageKey) => {
        try {
          const item = JSON.parse(localStorage.getItem(storageKey) || "null") as CachedFeed | null;
          return { storageKey, savedAt: Number(item?.savedAt || 0) };
        } catch {
          return { storageKey, savedAt: 0 };
        }
      })
      .sort((left, right) => right.savedAt - left.savedAt);
    entries.slice(NEWS_CACHE_MAX_ENTRIES).forEach(({ storageKey }) => localStorage.removeItem(storageKey));
  } catch {
    // Storage quota/privacy mode must never block the feed.
  }
}

function canPrefetchNews(): boolean {
  if (typeof navigator === "undefined") return true;
  return getRuntimePerformanceProfile().allowSecondaryRouteWarmup;
}

function scheduleIdleTask(task: () => void, delay = 1200): () => void {
  if (typeof window === "undefined") return () => undefined;
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  let idleHandle: number | null = null;
  const timerHandle = window.setTimeout(() => {
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(task, { timeout: 1000 });
      return;
    }
    task();
  }, Math.max(0, delay));

  return () => {
    window.clearTimeout(timerHandle);
    if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
  };
}

function warmCriticalNewsImages(posts: FeedPost[]): void {
  if (!canPrefetchNews()) return;
  const urls = posts
    .slice(0, 2)
    .flatMap((post) => [
      ...(post.topEmpresas || []).slice(0, 3).map((entry) => entry.logo),
      ...(post.topMotoristas || []).slice(0, 3).flatMap((entry) => [entry.foto, entry.empresaLogo]),
      post.empresaLogo,
      post.proprietarioFoto,
    ])
    .filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
    .slice(0, 8);
  if (urls.length > 0) void preloadImages(urls, 3);
}

function timestampToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as { toDate?: unknown })?.toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof (value as { seconds?: unknown })?.seconds === "number") {
    const date = new Date(Number((value as { seconds: number }).seconds) * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

function postTimestamp(post: FeedPost): number {
  return timestampToDate(post.sortAt)?.getTime() ||
    timestampToDate(post.dataReferencia)?.getTime() ||
    timestampToDate(post.createdAt)?.getTime() || 0;
}

function normalizeLookup(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simulatorFilterKey(value: unknown): string {
  const normalized = normalizeLookup(value).replace(/\s/g, "");
  if (!normalized) return "";
  if (normalized === "gto" || normalized.includes("globaltruckonline")) return "gto";
  if (normalized === "ets2" || normalized.includes("eurotrucksimulator2")) return "ets2";
  if (normalized === "ats" || normalized.includes("americantrucksimulator")) return "ats";
  if (normalized === "toe3" || normalized.includes("truckersofeurope3")) return "toe3";
  if (normalized === "wtds" || normalized.includes("worldtruckdrivingsimulator")) return "wtds";
  if (normalized === "wbds" || normalized.includes("worldbusdrivingsimulator")) return "wbds";
  if (normalized === "pbs" || normalized.includes("protonbussimulator")) return "pbs";
  return normalized;
}

function expandedSimulatorAliases(...values: unknown[]): string[] {
  const aliases = new Set<string>();
  values.forEach((value) => {
    const raw = normalizeLookup(value).replace(/\s/g, "");
    const canonical = simulatorFilterKey(value);
    if (raw) aliases.add(raw);
    if (canonical) aliases.add(canonical);
  });

  if (aliases.has("gto")) ["gto", "globaltruckonline"].forEach((value) => aliases.add(value));
  if (aliases.has("ets2")) ["ets2", "eurotrucksimulator2"].forEach((value) => aliases.add(value));
  if (aliases.has("ats")) ["ats", "americantrucksimulator"].forEach((value) => aliases.add(value));
  if (aliases.has("toe3")) ["toe3", "truckersofeurope3"].forEach((value) => aliases.add(value));
  if (aliases.has("wtds")) ["wtds", "worldtruckdrivingsimulator"].forEach((value) => aliases.add(value));
  if (aliases.has("wbds")) ["wbds", "worldbusdrivingsimulator"].forEach((value) => aliases.add(value));
  if (aliases.has("pbs")) ["pbs", "protonbussimulator"].forEach((value) => aliases.add(value));

  return Array.from(aliases).filter(Boolean).slice(0, 10);
}

function isAllSimulator(value: string): boolean {
  return !value || value === "all";
}

function feedCacheKey(
  userId: string,
  section: Section,
  period: PeriodFilter,
  simulator: string,
): string {
  return [userId, section, section === "noticias" ? period : "all", simulator || "all"].join(":");
}

function buildFeedConstraints(
  section: Section,
  period: PeriodFilter,
  simulator: string,
  simulatorAliases: string[],
  cursor: FeedCursor = null,
): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (!isAllSimulator(simulator)) {
    const queryAliases = section === "comunicados"
      ? Array.from(new Set(["all", ...simulatorAliases])).slice(0, 10)
      : simulatorAliases;
    if (queryAliases.length === 1) constraints.push(where("simuladorKey", "==", queryAliases[0]));
    if (queryAliases.length > 1) constraints.push(where("simuladorKey", "in", queryAliases));
  }
  // Period filtering is applied after the read so system posts without
  // `periodoTipo` (for example company approvals) remain visible in both
  // Semana and Mês. Server-side filtering would hide those posts entirely.
  void period;
  constraints.push(orderBy("sortAt", "desc"));
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(PAGE_SIZE));
  return constraints;
}

function isCompanyApprovalPost(post: FeedPost): boolean {
  const type = normalizeLookup(post.tipo || post.type || post.categoria || "");
  const title = normalizeLookup(post.titulo || "");
  return type === "empresa aprovada" ||
    type === "empresa_aprovada" ||
    type === "company approval" ||
    type === "company_approval" ||
    type === "nova empresa" ||
    type === "nova_empresa" ||
    title === "nova empresa no ecossistema nvu";
}

function approvalPostCompanyId(post: FeedPost): string {
  const nestedCompany = post.empresa && typeof post.empresa === "object"
    ? post.empresa as Record<string, unknown>
    : null;
  const legacyCompany = post.company && typeof post.company === "object"
    ? post.company as Record<string, unknown>
    : null;
  return String(
    post.empresaId ||
    post.companyId ||
    nestedCompany?.id ||
    legacyCompany?.id ||
    "",
  ).trim();
}

function isClosedRankingPost(post: FeedPost): boolean {
  return isRankingPeriodClosed(
    post.periodoTipo || post.periodicidade,
    post.periodoInicioKey as string | undefined,
    post.periodoFimKey as string | undefined,
  );
}

function postMatchesPeriod(post: FeedPost, period: PeriodFilter): boolean {
  if (isCompanyApprovalPost(post)) return true;
  if (!isClosedRankingPost(post)) return false;
  if (period === "all") return true;
  return (post.periodoTipo || post.periodicidade) === period;
}

function feedPostQuality(post: FeedPost): number {
  let score = 0;
  if (normalizeLookup(post.status || "publicado") === "publicado") score += 2;
  if (post.empresaLogo) score += 2;
  if (post.proprietarioFoto) score += 2;
  if (String(post.schemaVersion || "").includes("v6")) score += 4;
  if (String(post.id || "").startsWith("empresa_aprovada_empresa_")) score += 3;
  return score;
}

function deduplicateFeedPosts(posts: FeedPost[]): FeedPost[] {
  const deduplicated = new Map<string, FeedPost>();
  posts.forEach((post) => {
    const current = deduplicated.get(post.id);
    if (!current) {
      deduplicated.set(post.id, post);
      return;
    }
    const currentQuality = feedPostQuality(current);
    const nextQuality = feedPostQuality(post);
    if (
      nextQuality > currentQuality ||
      (nextQuality === currentQuality && postTimestamp(post) > postTimestamp(current))
    ) {
      deduplicated.set(post.id, post);
    }
  });
  return Array.from(deduplicated.values());
}

function postMatchesSimulator(
  post: FeedPost,
  section: Section,
  simulator: string,
  simulatorAliases: string[],
): boolean {
  if (isAllSimulator(simulator)) return true;
  const postAliases = expandedSimulatorAliases(
    post.simuladorKey,
    post.simuladorId,
    post.simulador,
    ...(Array.isArray(post.simuladorAliases) ? post.simuladorAliases : []),
  );
  if (section === "comunicados" && postAliases.some((value) => ["all", "todosossimuladores"].includes(value))) {
    return true;
  }
  return postAliases.some((alias) => simulatorAliases.includes(alias));
}

function isCurrentFeedCursor(expected: FeedCursor, current: FeedCursor): boolean {
  return expected === current;
}

function isActiveCompany(company: any): boolean {
  const status = String(company?.status || company?.situacao || company?.state || "active").trim().toLowerCase();
  const isDeleted = 
    company?.deleted === true || 
    company?.softDeleted === true || 
    company?.excluida === true || 
    company?.excluido === true ||
    ["deleted", "excluida", "excluido", "removed", "removida", "removido"].includes(status);
  
  return (status === "active" || status === "approved" || status === "ativo") && !isDeleted;
}

function safeReadStateId(userId: string, simulatorKey: string): string {
  return `${userId}_${simulatorKey}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 1400);
}

function sectionSeenKey(userId: string, simulatorKey: string, section: Section): string {
  return `nvu_news_last_seen_v4:${userId}:${simulatorKey}:${section}`;
}

function readLocalSeen(userId: string, simulatorKey: string, section: Section): number {
  if (typeof window === "undefined") return Date.now();
  const scopedKey = sectionSeenKey(userId, simulatorKey, section);
  const scoped = Number(localStorage.getItem(scopedKey) || 0);
  if (scoped > 0) return scoped;

  // Aproveita a marcação da versão anterior para não transformar todo o
  // histórico existente em conteúdo não lido após a atualização.
  const legacy = Number(localStorage.getItem(`nvu_news_last_seen_${section}_v3`) || 0);
  const initial = legacy > 0 ? legacy : Date.now();
  localStorage.setItem(scopedKey, String(initial));
  return initial;
}

function monthTitleLabel(post: FeedPost): string {
  if ((post.periodoTipo || post.periodicidade) !== "mes") return "";

  const key = String(post.periodoInicioKey || post.periodoFimKey || "").trim();
  const keyMatch = key.match(/^(\d{4})-(\d{1,2})-/);
  if (keyMatch) {
    const year = Number(keyMatch[1]);
    const month = Number(keyMatch[2]);
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      const label = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
      }).format(new Date(Date.UTC(year, month - 1, 1)));
      return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
    }
  }

  const period = String(post.periodo || "").trim();
  const periodMatch = period.match(/\b(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/i);
  if (periodMatch) {
    const normalizedMonth = periodMatch[1].toLocaleLowerCase("pt-BR").replace("marco", "março");
    return `${normalizedMonth.charAt(0).toLocaleUpperCase("pt-BR") + normalizedMonth.slice(1)} de ${periodMatch[2]}`;
  }

  return "";
}

function periodTitleSegment(post: FeedPost): string {
  if ((post.periodoTipo || post.periodicidade) !== "mes") return "semana";
  const month = monthTitleLabel(post);
  return month ? `mês de ${month}` : "mês";
}
function individualTitle(post: FeedPost, entity: RankingEntity, count: number): string {
  const period = periodTitleSegment(post);
  const plural = entity === "empresa" ? "empresas" : "motoristas";
  if (count === 1) {
    if ((post.periodoTipo || post.periodicidade) === "mes") {
      const month = monthTitleLabel(post);
      return month ? `Fim da temporada mensal — ${month}` : "Fim da temporada mensal";
    }
    return "Fim da temporada semanal";
  }
  if (count === 2) return `2 ${plural} em destaque no ${period} — ${post.simulador || "NVU"}`;
  return `3 melhores ${plural} do ${period} — ${post.simulador || "NVU"}`;
}

function expandIndividualPost(
  post: FeedPost,
  validCompanyIds: Set<string> | null,
  validCompaniesMap?: Map<string, any>
): FeedPost[] {
  const companies = (Array.isArray(post.topEmpresas) ? post.topEmpresas : [])
    .filter((entry) => !validCompanyIds || validCompanyIds.has(entry.id))
    .slice(0, 3)
    .map((entry, index) => ({ ...entry, posicao: index + 1 }));
  const drivers = (Array.isArray(post.topMotoristas) ? post.topMotoristas : [])
    .filter((entry) => !entry.empresaId || !validCompanyIds || validCompanyIds.has(entry.empresaId))
    .slice(0, 3)
    .map((entry, index) => ({ ...entry, posicao: index + 1 }));

  if (post.tipo !== "classificacao") {
    if (isCompanyApprovalPost(post)) {
      const companyId = approvalPostCompanyId(post);
      if (companyId) {
        if (validCompanyIds && !validCompanyIds.has(companyId)) return [];
        const activeCompanyData = validCompaniesMap?.get(companyId);
        if (!validCompanyIds && validCompaniesMap && !activeCompanyData) return [];
        if (activeCompanyData) {
          const resolvedCompanyName = activeCompanyData.companyName || activeCompanyData.fleetName || post.empresaNome;
          const resolvedCompanyLogo = activeCompanyData.logoUrl || activeCompanyData.logoURL || activeCompanyData.companyLogoURL || activeCompanyData.companyLogoUrl || post.empresaLogo;
          const resolvedOwnerName = activeCompanyData.ownerName || post.proprietarioNome;
          const resolvedOwnerPhoto = activeCompanyData.ownerPhotoUrl || activeCompanyData.ownerPhotoURL || post.proprietarioFoto;
          return [{
            ...post,
            id: `empresa_aprovada_empresa_${companyId}`,
            empresaNome: resolvedCompanyName,
            empresaLogo: resolvedCompanyLogo,
            proprietarioNome: resolvedOwnerName,
            proprietarioFoto: resolvedOwnerPhoto,
            empresa: {
              ...(typeof post.empresa === "object" && post.empresa ? post.empresa : {}),
              id: companyId,
              nome: resolvedCompanyName,
              logo: resolvedCompanyLogo,
            },
            proprietario: {
              ...(typeof post.proprietario === "object" && post.proprietario ? post.proprietario : {}),
              id: activeCompanyData.ownerId || activeCompanyData.userId || post.proprietarioId,
              nome: resolvedOwnerName,
              foto: resolvedOwnerPhoto,
            },
          }];
        }
        
        return [{
          ...post,
          id: `empresa_aprovada_empresa_${companyId}`,
        }];
      }
      if (validCompanyIds) return [];
    }
    return [post];
  }
  if (post.entidade === "empresa") return companies.length > 0 ? [{ ...post, topEmpresas: companies, topMotoristas: [] }] : [];
  if (post.entidade === "motorista") return drivers.length > 0 ? [{ ...post, topEmpresas: [], topMotoristas: drivers }] : [];

  const split: FeedPost[] = [];
  if (companies.length > 0) {
    split.push({
      ...post,
      id: `${post.id}__empresa`,
      entidade: "empresa",
      titulo: individualTitle(post, "empresa", companies.length),
      topEmpresas: companies,
      topMotoristas: [],
    });
  }
  if (drivers.length > 0) {
    split.push({
      ...post,
      id: `${post.id}__motorista`,
      entidade: "motorista",
      titulo: individualTitle(post, "motorista", drivers.length),
      topEmpresas: [],
      topMotoristas: drivers,
    });
  }
  return split;
}

export async function warmNvuNewsFirstPage({
  userId,
  simulatorValues,
}: {
  userId?: string | null;
  simulatorValues: unknown[];
}): Promise<void> {
  if (!userId || !canPrefetchNews()) return;
  const simulatorAliases = expandedSimulatorAliases(...simulatorValues);
  const simulator = simulatorValues
    .map((value) => simulatorFilterKey(value))
    .find((value) => simulatorAliases.includes(value)) || simulatorAliases[0] || "";
  if (!simulator) return;

  for (const section of ["noticias", "comunicados"] as Section[]) {
    const cacheKey = feedCacheKey(userId, section, "all", simulator);
    const cached = readFeedCache(cacheKey);
    if (cached) {
      if (section === "noticias") warmCriticalNewsImages(cached.posts);
      continue;
    }

    const existing = newsWarmupInFlight.get(cacheKey);
    if (existing) {
      await existing;
      continue;
    }

    const task = (async () => {
      try {
        const snapshot = await getDocs(query(
          collection(db, COLLECTIONS[section]),
          ...buildFeedConstraints(section, "all", simulator, simulatorAliases),
        ));
        const warmedPosts = deduplicateFeedPosts(snapshot.docs
          .map((document) => ({ id: document.id, ...document.data() } as FeedPost))
          .filter((post) => normalizeLookup(post.status || "publicado") === "publicado")
          .filter((post) => isClosedRankingPost(post))
          .filter((post) => postMatchesSimulator(post, section, simulator, simulatorAliases))
          .flatMap((post) => expandIndividualPost(post, null)));
        memoryFeedCursors.set(cacheKey, snapshot.docs[snapshot.docs.length - 1] || null);
        writeFeedCache(cacheKey, {
          savedAt: Date.now(),
          posts: warmedPosts,
          hasMore: snapshot.size === PAGE_SIZE,
        });
        if (section === "noticias") warmCriticalNewsImages(warmedPosts);
      } catch (error) {
        console.warn(`[NVU NEWS] Aquecimento inicial de ${section} indisponível:`, error);
      } finally {
        newsWarmupInFlight.delete(cacheKey);
      }
    })();

    newsWarmupInFlight.set(cacheKey, task);
    await task;
  }
}

export default function NewsFeed() {
  const { currentUser } = useSessionStore();
  const {
    allCompanies,
    companies,
    activeCompanyId,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
  } = useCompanyStore();
  const { simulators } = useOperationalStore();
  const initialCompany = [...(allCompanies || []), ...(companies || [])].find((company: any) => (
    isActiveCompany(company) &&
    (company?.id === activeCompanyId || company?.id === (currentUser as any)?.companyId)
  ));
  const initialSimulatorId = initialCompany?.simulatorId || initialCompany?.simuladorId ||
    (currentUser as any)?.currentRecruitmentSimulatorId ||
    (currentUser as any)?.simulatorId ||
    (currentUser as any)?.simuladorId;
  const initialSimulatorDocument = (simulators || []).find((simulator: any) => simulator?.id === initialSimulatorId);
  const initialSimulatorKey = simulatorFilterKey(
    initialSimulatorDocument?.name ||
    initialCompany?.simulatorName ||
    initialCompany?.simuladorNome ||
    (currentUser as any)?.simulatorName ||
    (currentUser as any)?.simuladorNome ||
    (currentUser as any)?.simulator ||
    initialSimulatorId,
  );
  const [activeSection, setActiveSection] = useState<Section>("noticias");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [selectedSimulator, setSelectedSimulator] = useState(initialSimulatorKey || "");
  const [simulatorReady, setSimulatorReady] = useState(Boolean(initialSimulatorKey));
  const [searchTerm, setSearchTerm] = useState("");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const cursorRef = useRef<FeedCursor>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const historyPreparing = false;
  const [feedReady, setFeedReady] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<Section, number>>({ noticias: 0, comunicados: 0 });
  const [readStateReady, setReadStateReady] = useState(false);
  const seenTimestampsRef = useRef<Record<Section, number>>({ noticias: 0, comunicados: 0 });
  const unreadRefreshScopeRef = useRef("");
  const unreadLastCompletedAtRef = useRef(0);
  const unreadInFlightRef = useRef<Promise<void> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const initialLoadCompletedRef = useRef(false);
  const simulatorSelectionModeRef = useRef<"pending" | "auto" | "user">(initialSimulatorKey ? "auto" : "pending");
  const remoteSearchActiveRef = useRef(false);
  const autoSimulatorSourceRef = useRef("");
  const postsRef = useRef<FeedPost[]>([]);
  const lastQueryKeyRef = useRef("");
  const loadingMoreRef = useRef(false);
  const prefetchedNextPagesRef = useRef(new Map<string, PrefetchedPage>());
  const nextPagePrefetchInFlightRef = useRef(new Map<string, Promise<void>>());
  const variantPrefetchInFlightRef = useRef(new Set<string>());
  const liveFirstPageIdsRef = useRef<Set<string>>(new Set());
  const companyCatalogRefreshAtRef = useRef(0);
  const scrollRestoreKeyRef = useRef("");
  const scrollSaveFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (companyCatalogLoaded || companyCatalogAttempted) return;
    void loadCompanyCatalog();
  }, [companyCatalogAttempted, companyCatalogLoaded, loadCompanyCatalog]);

  const validCompaniesMap = useMemo(() => {
    const map = new Map<string, any>();
    const currentUserId = String(currentUser?.id || "").trim();
    const currentUserPhoto = String(
      (currentUser as any)?.profilePhotoURL ||
      (currentUser as any)?.profilePhotoUrl ||
      (currentUser as any)?.photoURL ||
      (currentUser as any)?.photoUrl ||
      (currentUser as any)?.authPhotoURL ||
      (currentUser as any)?.avatar ||
      "",
    ).trim();
    [...(allCompanies || []), ...(companies || [])].forEach((company: any) => {
      if (!company?.id || !isActiveCompany(company)) return;
      const companySimulatorId = String(
        company.simulatorId || company.simuladorId || "",
      ).trim();
      const catalogSimulator = (simulators || []).find(
        (simulator: any) => String(simulator?.id || "") === companySimulatorId,
      );
      const canonicalCompany = catalogSimulator?.name
        ? {
            ...company,
            simulatorId: catalogSimulator.id,
            simulatorName: catalogSimulator.name,
          }
        : company;
      const isCurrentOwner = Boolean(
        currentUserId &&
        (String(canonicalCompany.ownerId || "") === currentUserId ||
          String(canonicalCompany.userId || "") === currentUserId),
      );
      map.set(company.id, isCurrentOwner ? {
        ...canonicalCompany,
        ownerName: String(currentUser?.name || canonicalCompany.ownerName || "").trim(),
        ownerPhotoUrl: currentUserPhoto || canonicalCompany.ownerPhotoUrl || canonicalCompany.ownerPhotoURL || "",
      } : canonicalCompany);
    });
    return map;
  }, [allCompanies, companies, currentUser, simulators]);

  const validCompanies = useMemo(() => {
    return Array.from(validCompaniesMap.values());
  }, [validCompaniesMap]);

  const validCompanyIds = useMemo<Set<string> | null>(() => {
    if (!companyCatalogLoaded) return null;
    if ((allCompanies || []).length === 0 && (companies || []).length === 0) return null;
    return new Set(validCompaniesMap.keys());
  }, [companyCatalogLoaded, validCompaniesMap]);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    if (!validCompanyIds || !validCompaniesMap) return;
    setPosts((current) => {
      const sanitized = current.flatMap((post) => expandIndividualPost(post, validCompanyIds, validCompaniesMap));
      const deduplicated = deduplicateFeedPosts(sanitized);
      postsRef.current = deduplicated;
      return deduplicated;
    });
  }, [validCompanyIds, validCompaniesMap]);

  const sessionSimulator = useMemo(() => {
    const activeCompany = validCompanies.find((company: any) => company.id === activeCompanyId) ||
      validCompanies.find((company: any) => company.id === (currentUser as any)?.companyId);
    const rawSimulatorId = activeCompany?.simulatorId || activeCompany?.simuladorId ||
      (currentUser as any)?.currentRecruitmentSimulatorId || (currentUser as any)?.simulatorId || (currentUser as any)?.simuladorId;
    const simulatorDocument = (simulators || []).find((simulator: any) => simulator?.id === rawSimulatorId);
    const label = simulatorDocument?.name || activeCompany?.simulatorName || activeCompany?.simuladorNome ||
      (currentUser as any)?.simulatorName || (currentUser as any)?.simuladorNome || (currentUser as any)?.simulator;
    return {
      key: simulatorFilterKey(label || rawSimulatorId),
      label: String(label || rawSimulatorId || "").trim(),
      aliases: expandedSimulatorAliases(rawSimulatorId, label, simulatorDocument?.id, simulatorDocument?.name),
    };
  }, [activeCompanyId, currentUser, simulators, validCompanies]);

  useEffect(() => {
    const userId = String(currentUser?.id || "").trim();
    const simulatorKey = sessionSimulator.key;
    if (!userId || !simulatorKey) {
      setReadStateReady(false);
      return;
    }

    let cancelled = false;
    const localSeen = {
      noticias: readLocalSeen(userId, simulatorKey, "noticias"),
      comunicados: readLocalSeen(userId, simulatorKey, "comunicados"),
    };
    seenTimestampsRef.current = localSeen;
    setUnreadCounts({ noticias: 0, comunicados: 0 });
    setReadStateReady(false);

    void (async () => {
      const stateRef = doc(db, "nvu_news_read_state", safeReadStateId(userId, simulatorKey));
      try {
        const snapshot = await getDoc(stateRef);
        if (cancelled) return;
        if (snapshot.exists()) {
          const data = snapshot.data();
          const resolved = {
            noticias: Math.max(localSeen.noticias, Number(data.noticiasSeenAtMs || 0)),
            comunicados: Math.max(localSeen.comunicados, Number(data.comunicadosSeenAtMs || 0)),
          };
          localStorage.setItem(sectionSeenKey(userId, simulatorKey, "noticias"), String(resolved.noticias));
          localStorage.setItem(sectionSeenKey(userId, simulatorKey, "comunicados"), String(resolved.comunicados));
          seenTimestampsRef.current = resolved;
        } else {
          await setDoc(stateRef, {
            userId,
            simulatorKey,
            noticiasSeenAtMs: localSeen.noticias,
            comunicadosSeenAtMs: localSeen.comunicados,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        console.warn("[NVU NEWS] Estado remoto de leitura indisponível; usando armazenamento local.", error);
      } finally {
        if (!cancelled) setReadStateReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, sessionSimulator.key]);

  const simulatorOptions = useMemo<SimulatorOption[]>(() => {
    const map = new Map<string, SimulatorOption>();
    const add = (id: unknown, name: unknown) => {
      const key = simulatorFilterKey(name || id);
      const label = String(name || id || "").trim();
      if (!key || !label) return;
      const aliases = expandedSimulatorAliases(id, name, key);
      const current = map.get(key);
      if (current) {
        current.aliases = Array.from(new Set([...current.aliases, ...aliases])).slice(0, 10);
      } else {
        map.set(key, { value: key, label, aliases });
      }
    };

    (simulators || []).forEach((simulator: any) => add(simulator?.id, simulator?.name));
    validCompanies.forEach((company: any) => {
      add(company?.simulatorId || company?.simuladorId, company?.simulatorName || company?.simuladorNome || company?.simulator);
    });
    add(sessionSimulator.key, sessionSimulator.label);

    return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }, [sessionSimulator, simulators, validCompanies]);

  useEffect(() => {
    if (!sessionSimulator.key) {
      if (simulatorSelectionModeRef.current !== "pending") return;
      const fallbackTimer = window.setTimeout(() => {
        if (simulatorSelectionModeRef.current !== "pending") return;
        simulatorSelectionModeRef.current = "auto";
        setSelectedSimulator("all");
        setSimulatorReady(true);
      }, 220);
      return () => window.clearTimeout(fallbackTimer);
    }
    const sourceKey = `${activeCompanyId || (currentUser as any)?.companyId || "account"}:${sessionSimulator.key}`;
    if (autoSimulatorSourceRef.current === sourceKey && simulatorReady) return;
    autoSimulatorSourceRef.current = sourceKey;
    simulatorSelectionModeRef.current = "auto";
    setSelectedSimulator(sessionSimulator.key);
    setSimulatorReady(true);
  }, [activeCompanyId, currentUser, sessionSimulator.key, simulatorReady]);

  const selectedSimulatorOption = useMemo(() => {
    if (isAllSimulator(selectedSimulator)) return null;
    return simulatorOptions.find((option) => option.value === selectedSimulator) || {
      value: selectedSimulator,
      label: sessionSimulator.label || selectedSimulator,
      aliases: expandedSimulatorAliases(selectedSimulator, sessionSimulator.label, ...sessionSimulator.aliases),
    };
  }, [selectedSimulator, sessionSimulator, simulatorOptions]);

  const activeSimulatorLabel = isAllSimulator(selectedSimulator)
    ? "Todos os simuladores"
    : selectedSimulatorOption?.label || "Simulador atual";

  const selectedSimulatorAliases = useMemo(() => {
    if (isAllSimulator(selectedSimulator)) return [];
    return Array.from(new Set([
      selectedSimulator,
      ...(selectedSimulatorOption?.aliases || []),
      ...expandedSimulatorAliases(selectedSimulatorOption?.label),
    ])).filter(Boolean).slice(0, 10);
  }, [selectedSimulator, selectedSimulatorOption]);

  const activeQueryKey = useMemo(() => {
    if (!currentUser?.id || !simulatorReady) return "";
    return feedCacheKey(
      String(currentUser.id),
      activeSection,
      periodFilter,
      selectedSimulator || "all",
    );
  }, [activeSection, currentUser?.id, periodFilter, selectedSimulator, simulatorReady]);

  const postMatchesSelectedSimulator = useCallback((post: FeedPost) => {
    return postMatchesSimulator(post, activeSection, selectedSimulator, selectedSimulatorAliases);
  }, [activeSection, selectedSimulator, selectedSimulatorAliases]);

  const processDocuments = useCallback((
    documents: QueryDocumentSnapshot<DocumentData>[],
    section: Section,
    simulator: string,
    simulatorAliases: string[],
  ): FeedPost[] => {
    const processed = documents
      .map((document) => ({ id: document.id, ...document.data() } as FeedPost))
      .filter((post) => normalizeLookup(post.status || "publicado") === "publicado")
      .filter((post) => isClosedRankingPost(post))
      .filter((post) => postMatchesSimulator(post, section, simulator, simulatorAliases))
      .flatMap((post) => expandIndividualPost(post, validCompanyIds, validCompaniesMap));
      
    // Deduplicate by ID
    return deduplicateFeedPosts(processed);
  }, [validCompanyIds, validCompaniesMap]);

  const sanitizeCachedPosts = useCallback((cachedPosts: FeedPost[]): FeedPost[] => {
          const processed = cachedPosts
        .filter((post) => isClosedRankingPost(post))
        .flatMap((post) => expandIndividualPost(post, validCompanyIds, validCompaniesMap));

    return deduplicateFeedPosts(processed);
  }, [validCompanyIds, validCompaniesMap]);

  const markSectionSeen = useCallback((section: Section, timestamp: number) => {
    const userId = String(currentUser?.id || "").trim();
    const simulatorKey = sessionSimulator.key;
    if (!userId || !simulatorKey || timestamp <= 0) return;

    const resolvedTimestamp = Math.max(seenTimestampsRef.current[section], timestamp);
    seenTimestampsRef.current = { ...seenTimestampsRef.current, [section]: resolvedTimestamp };
    localStorage.setItem(sectionSeenKey(userId, simulatorKey, section), String(resolvedTimestamp));
    setUnreadCounts((current) => ({ ...current, [section]: 0 }));

    const stateRef = doc(db, "nvu_news_read_state", safeReadStateId(userId, simulatorKey));
    void setDoc(stateRef, {
      userId,
      simulatorKey,
      [`${section}SeenAtMs`]: resolvedTimestamp,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch((error) => {
      console.warn("[NVU NEWS] Não foi possível sincronizar a leitura do feed.", error);
    });
  }, [currentUser?.id, sessionSimulator.key]);

  const loadUnreadIndicators = useCallback(async (force = false) => {
    if (!readStateReady || !currentUser?.id || !sessionSimulator.key) return;

    const scopeKey = `${currentUser.id}|${sessionSimulator.key}`;
    if (unreadRefreshScopeRef.current !== scopeKey) {
      unreadRefreshScopeRef.current = scopeKey;
      unreadLastCompletedAtRef.current = 0;
      unreadInFlightRef.current = null;
    }

    if (unreadInFlightRef.current) {
      await unreadInFlightRef.current;
      return;
    }

    if (
      !force &&
      Date.now() - unreadLastCompletedAtRef.current <
        UNREAD_REFRESH_MIN_INTERVAL_MS
    ) {
      return;
    }

    const task = (async () => {
      const entries = await Promise.all((Object.keys(COLLECTIONS) as Section[]).map(async (section) => {
        try {
          const aliases = section === "comunicados"
            ? Array.from(new Set(["all", ...sessionSimulator.aliases, sessionSimulator.key])).filter(Boolean).slice(0, 10)
            : Array.from(new Set([sessionSimulator.key, ...sessionSimulator.aliases])).filter(Boolean).slice(0, 10);
          const simulatorConstraints: QueryConstraint[] = [];
          if (aliases.length === 1) simulatorConstraints.push(where("simuladorKey", "==", aliases[0]));
          if (aliases.length > 1) simulatorConstraints.push(where("simuladorKey", "in", aliases));

          const seenAtMs = Math.max(0, seenTimestampsRef.current[section] || 0);
          try {
            const aggregateSnapshot = await getCountFromServer(query(
              collection(db, COLLECTIONS[section]),
              ...simulatorConstraints,
              where("status", "==", "publicado"),
              where("sortAt", ">", Timestamp.fromMillis(seenAtMs)),
              orderBy("sortAt", "desc"),
            ));
            return [section, aggregateSnapshot.data().count] as const;
          } catch (aggregateError) {
            // Fallback temporário preserva o contador caso um índice ainda não tenha sido publicado.
            if (import.meta.env.DEV) {
              console.warn(`[NVU NEWS] Agregação indisponível em ${section}; usando leitura limitada.`, aggregateError);
            }
          }

          const fallbackConstraints: QueryConstraint[] = [
            ...simulatorConstraints,
            orderBy("sortAt", "desc"),
            limit(UNREAD_SCAN_LIMIT),
          ];
          const snapshot = await getDocs(query(collection(db, COLLECTIONS[section]), ...fallbackConstraints));
          const visible = snapshot.docs
            .map((document) => ({ id: document.id, ...document.data() } as FeedPost))
            .filter((post) => normalizeLookup(post.status || "publicado") === "publicado")
            .filter((post) => isClosedRankingPost(post))
            .filter((post) => postMatchesSimulator(post, section, sessionSimulator.key, sessionSimulator.aliases));
          const unread = visible.reduce(
            (count, post) => count + (postTimestamp(post) > seenAtMs ? 1 : 0),
            0,
          );
          return [section, unread] as const;
        } catch (error) {
          console.warn(`[NVU NEWS] Não foi possível contar publicações não lidas em ${section}:`, error);
          return [section, 0] as const;
        }
      }));

      setUnreadCounts(Object.fromEntries(entries) as Record<Section, number>);
      unreadLastCompletedAtRef.current = Date.now();
    })();

    unreadInFlightRef.current = task;
    try {
      await task;
    } finally {
      if (unreadInFlightRef.current === task) unreadInFlightRef.current = null;
    }
  }, [currentUser?.id, readStateReady, sessionSimulator.aliases, sessionSimulator.key]);

  const prefetchNextPage = useCallback((
    queryKey: string,
    section: Section,
    period: PeriodFilter,
    simulator: string,
    simulatorAliases: string[],
    cursor: FeedCursor,
    generation: number,
  ): Promise<void> => {
    if (
      !cursor ||
      !canPrefetchNews() ||
      requestRef.current !== generation ||
      !isCurrentFeedCursor(cursor, cursorRef.current) ||
      prefetchedNextPagesRef.current.has(queryKey)
    ) {
      return Promise.resolve();
    }
    const flightKey = `${queryKey}:${generation}`;
    const existing = nextPagePrefetchInFlightRef.current.get(flightKey);
    if (existing) return existing;

    const task = (async () => {
      try {
        const snapshot = await getDocs(query(
          collection(db, COLLECTIONS[section]),
          ...buildFeedConstraints(section, period, simulator, simulatorAliases, cursor),
        ));
        const page = processDocuments(snapshot.docs, section, simulator, simulatorAliases);
        if (
          requestRef.current === generation &&
          isCurrentFeedCursor(cursor, cursorRef.current)
        ) {
          prefetchedNextPagesRef.current.set(queryKey, {
            posts: page,
            cursor: snapshot.docs[snapshot.docs.length - 1] || null,
            hasMore: snapshot.size === PAGE_SIZE,
          });
        }
      } catch (error) {
        console.warn("[NVU NEWS] Pré-carregamento da próxima página indisponível:", error);
      } finally {
        nextPagePrefetchInFlightRef.current.delete(flightKey);
      }
    })();
    nextPagePrefetchInFlightRef.current.set(flightKey, task);
    return task;
  }, [processDocuments]);

  const fetchPosts = useCallback(async (loadMore = false, silent = false): Promise<void> => {
    if (!currentUser?.id || !simulatorReady || !activeQueryKey) return;

    if (!loadMore) setFeedError(null);

    if (loadMore) {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      if (!cursorRef.current) {
        setLoadingMore(true);
        loadingMoreRef.current = false;
        await fetchPosts(false, true);
        if (lastQueryKeyRef.current === activeQueryKey && cursorRef.current) {
          await fetchPosts(true, false);
        }
        return;
      }
      const inFlightPrefetch = nextPagePrefetchInFlightRef.current.get(`${activeQueryKey}:${requestRef.current}`);
      if (inFlightPrefetch) {
        setLoadingMore(true);
        await inFlightPrefetch;
        setLoadingMore(false);
        if (lastQueryKeyRef.current !== activeQueryKey) {
          loadingMoreRef.current = false;
          return;
        }
      }
      const prefetched = prefetchedNextPagesRef.current.get(activeQueryKey);
      if (prefetched) {
        prefetchedNextPagesRef.current.delete(activeQueryKey);
        const merged = deduplicateFeedPosts([...postsRef.current, ...prefetched.posts]);
        postsRef.current = merged;
        setPosts(merged);
        cursorRef.current = prefetched.cursor;
        setHasMore(prefetched.hasMore);
        loadingMoreRef.current = false;
        if (prefetched.hasMore && prefetched.cursor) {
          scheduleIdleTask(() => {
            void prefetchNextPage(
              activeQueryKey,
              activeSection,
              periodFilter,
              selectedSimulator,
              selectedSimulatorAliases,
              prefetched.cursor,
              requestRef.current,
            );
          });
        }
        return;
      }
      setLoadingMore(true);
    }

    const requestId = loadMore ? requestRef.current : requestRef.current + 1;
    if (!loadMore) requestRef.current = requestId;
    if (!loadMore) prefetchedNextPagesRef.current.delete(activeQueryKey);

    if (!loadMore && !silent) {
      if (!initialLoadCompletedRef.current && postsRef.current.length === 0) setLoading(true);
      else setRefreshing(true);
    }

    try {
      const snapshot = await getDocs(query(
        collection(db, COLLECTIONS[activeSection]),
        ...buildFeedConstraints(
          activeSection,
          periodFilter,
          selectedSimulator,
          selectedSimulatorAliases,
          loadMore ? cursorRef.current : null,
        ),
      ));
      if (requestId !== requestRef.current) return;

      const fetched = processDocuments(snapshot.docs, activeSection, selectedSimulator, selectedSimulatorAliases);
      const nextPosts = loadMore
        ? deduplicateFeedPosts([...postsRef.current, ...fetched])
        : fetched;

      if (!loadMore && activeSection === "noticias") warmCriticalNewsImages(nextPosts);
      setFeedError(null);
      postsRef.current = nextPosts;
      setPosts(nextPosts);
      initialLoadCompletedRef.current = true;
      setFeedReady(true);
      cursorRef.current = snapshot.docs[snapshot.docs.length - 1] || null;
      const moreAvailable = snapshot.size === PAGE_SIZE;
      setHasMore(moreAvailable);
      if (!loadMore) {
        memoryFeedCursors.set(activeQueryKey, cursorRef.current);
        writeFeedCache(activeQueryKey, {
          savedAt: Date.now(),
          posts: nextPosts,
          hasMore: moreAvailable,
        });
      }

      const newestForSession = fetched
        .filter((post) => postMatchesSimulator(post, activeSection, sessionSimulator.key, sessionSimulator.aliases))
        .reduce((max, post) => Math.max(max, postTimestamp(post)), 0);
      const viewingSessionFeed = selectedSimulator === sessionSimulator.key || isAllSimulator(selectedSimulator);
      if (!loadMore && viewingSessionFeed && newestForSession > 0) {
        markSectionSeen(activeSection, newestForSession);
      }

      if (moreAvailable && cursorRef.current && canPrefetchNews()) {
        const nextCursor = cursorRef.current;
        scheduleIdleTask(() => {
          void prefetchNextPage(
            activeQueryKey,
            activeSection,
            periodFilter,
            selectedSimulator,
            selectedSimulatorAliases,
            nextCursor,
            requestId,
          );
        });
      }
    } catch (error) {
      console.error("[NVU NEWS] Falha ao carregar publicações:", error);
      if (!loadMore) {
        setFeedError(
          postsRef.current.length > 0
            ? "Não foi possível atualizar agora. O conteúdo salvo continua disponível."
            : "Não foi possível carregar as publicações. Verifique sua conexão e tente novamente.",
        );
      }
      if (!loadMore && postsRef.current.length === 0) setPosts([]);
      if (postsRef.current.length === 0) setHasMore(false);
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
      if (loadMore) loadingMoreRef.current = false;
    }
  }, [
    activeQueryKey,
    activeSection,
    currentUser?.id,
    markSectionSeen,
    periodFilter,
    prefetchNextPage,
    processDocuments,
    selectedSimulator,
    selectedSimulatorAliases,
    sessionSimulator.aliases,
    sessionSimulator.key,
    simulatorReady,
  ]);

  const prefetchVariant = useCallback(async (section: Section, period: PeriodFilter) => {
    if (!currentUser?.id || !simulatorReady || !canPrefetchNews()) return;
    const queryKey = feedCacheKey(String(currentUser.id), section, period, selectedSimulator || "all");
    const cached = readFeedCache(queryKey);
    if (cached && Date.now() - cached.savedAt < NEWS_CACHE_FRESH_MS) return;
    if (variantPrefetchInFlightRef.current.has(queryKey)) return;
    variantPrefetchInFlightRef.current.add(queryKey);
    try {
      const snapshot = await getDocs(query(
        collection(db, COLLECTIONS[section]),
        ...buildFeedConstraints(section, period, selectedSimulator, selectedSimulatorAliases),
      ));
      const prefetchedPosts = processDocuments(snapshot.docs, section, selectedSimulator, selectedSimulatorAliases);
      memoryFeedCursors.set(queryKey, snapshot.docs[snapshot.docs.length - 1] || null);
      writeFeedCache(queryKey, {
        savedAt: Date.now(),
        posts: prefetchedPosts,
        hasMore: snapshot.size === PAGE_SIZE,
      });
    } catch (error) {
      console.warn(`[NVU NEWS] Pré-carregamento de ${section}/${period} indisponível:`, error);
    } finally {
      variantPrefetchInFlightRef.current.delete(queryKey);
    }
  }, [currentUser?.id, processDocuments, selectedSimulator, selectedSimulatorAliases, simulatorReady]);

  useEffect(() => {
    if (!simulatorReady || !activeQueryKey || remoteSearchActiveRef.current) return;
    if (normalizeLookup(searchTerm).length >= 3) return;
    if (lastQueryKeyRef.current === activeQueryKey) return;
    lastQueryKeyRef.current = activeQueryKey;
    requestRef.current += 1;
    setFeedError(null);
    const generation = requestRef.current;
    cursorRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    prefetchedNextPagesRef.current.delete(activeQueryKey);

    const hydrateCachedFeed = (cached: CachedFeed) => {
      if (lastQueryKeyRef.current !== activeQueryKey || requestRef.current !== generation) return;
      const hydratedPosts = sanitizeCachedPosts(cached.posts);
      if (activeSection === "noticias") warmCriticalNewsImages(hydratedPosts);
      postsRef.current = hydratedPosts;
      setPosts(hydratedPosts);
      cursorRef.current = memoryFeedCursors.get(activeQueryKey) || null;
      setHasMore(cached.hasMore);
      setLoading(false);
      setRefreshing(false);
      initialLoadCompletedRef.current = true;
      setFeedReady(true);
      const newestForSession = hydratedPosts
        .filter((post) => postMatchesSimulator(post, activeSection, sessionSimulator.key, sessionSimulator.aliases))
        .reduce((max, post) => Math.max(max, postTimestamp(post)), 0);
      const viewingSessionFeed = selectedSimulator === sessionSimulator.key || isAllSimulator(selectedSimulator);
      if (viewingSessionFeed && newestForSession > 0) {
        markSectionSeen(activeSection, newestForSession);
      }
      if (cached.hasMore && cursorRef.current && canPrefetchNews()) {
        const firstPageCursor = cursorRef.current;
        scheduleIdleTask(() => {
          void prefetchNextPage(
            activeQueryKey,
            activeSection,
            periodFilter,
            selectedSimulator,
            selectedSimulatorAliases,
            firstPageCursor,
            generation,
          );
        }, 650);
      }
    };

    const cached = readFeedCache(activeQueryKey);
    if (cached) {
      hydrateCachedFeed(cached);
      const fresh = Date.now() - cached.savedAt < NEWS_CACHE_FRESH_MS;
      if (fresh) {
        return scheduleIdleTask(() => void fetchPosts(false, true), 1400);
      }
      void fetchPosts(false, true);
      return;
    }

    postsRef.current = [];
    setPosts([]);
    setHasMore(true);
    initialLoadCompletedRef.current = false;
    setLoading(true);

    const warmup = newsWarmupInFlight.get(activeQueryKey);
    if (!warmup) {
      void fetchPosts(false, false);
      return;
    }

    let canceled = false;
    void warmup.finally(() => {
      if (canceled || lastQueryKeyRef.current !== activeQueryKey || requestRef.current !== generation) return;
      const warmed = readFeedCache(activeQueryKey);
      if (warmed) {
        hydrateCachedFeed(warmed);
        return;
      }
      void fetchPosts(false, false);
    });
    return () => {
      canceled = true;
    };
  }, [
    activeQueryKey,
    activeSection,
    fetchPosts,
    markSectionSeen,
    periodFilter,
    prefetchNextPage,
    sanitizeCachedPosts,
    searchTerm,
    selectedSimulator,
    selectedSimulatorAliases,
    sessionSimulator.aliases,
    sessionSimulator.key,
    simulatorReady,
  ]);

  useEffect(() => {
    if (!feedReady || !canPrefetchNews()) return;
    return scheduleIdleTask(() => {
      const variants: Array<[Section, PeriodFilter]> = activeSection === "noticias"
        ? [["comunicados", "all"], ["noticias", "semana"], ["noticias", "mes"]]
        : [["noticias", "all"], ["noticias", "semana"], ["noticias", "mes"]];
      void variants.reduce(
        (chain, [section, period]) => chain.then(() => prefetchVariant(section, period)),
        Promise.resolve(),
      );
    }, 900);
  }, [activeSection, feedReady, prefetchVariant]);

  useEffect(() => {
    if (
      !feedReady ||
      !currentUser?.id ||
      !simulatorReady ||
      !activeQueryKey ||
      remoteSearchActiveRef.current
    ) return;

    liveFirstPageIdsRef.current = new Set();
    const liveQuery = query(
      collection(db, COLLECTIONS[activeSection]),
      ...buildFeedConstraints(
        activeSection,
        periodFilter,
        selectedSimulator,
        selectedSimulatorAliases,
      ),
    );

    const unsubscribe = onSnapshot(
      liveQuery,
      (snapshot) => {
        if (lastQueryKeyRef.current !== activeQueryKey) return;
        const firstPage = processDocuments(
          snapshot.docs,
          activeSection,
          selectedSimulator,
          selectedSimulatorAliases,
        );
        const previousFirstPageIds = liveFirstPageIdsRef.current;
        const nextFirstPageIds = new Set(firstPage.map((post) => post.id));
        liveFirstPageIdsRef.current = nextFirstPageIds;

        setPosts((current) => {
          const olderPosts = current.filter(
            (post) =>
              !previousFirstPageIds.has(post.id) &&
              !nextFirstPageIds.has(post.id),
          );
          const merged = deduplicateFeedPosts([...firstPage, ...olderPosts])
            .sort((left, right) => postTimestamp(right) - postTimestamp(left));
          postsRef.current = merged;
          writeFeedCache(activeQueryKey, {
            savedAt: Date.now(),
            posts: merged,
            hasMore: snapshot.size === PAGE_SIZE,
          });
          return merged;
        });

        cursorRef.current = snapshot.docs[snapshot.docs.length - 1] || null;
        memoryFeedCursors.set(activeQueryKey, cursorRef.current);
        setHasMore(snapshot.size === PAGE_SIZE);
        if (activeSection === "noticias") warmCriticalNewsImages(firstPage);
      },
      (error) => {
        console.warn("[NVU NEWS] Atualização em tempo real indisponível:", error);
      },
    );

    return () => {
      unsubscribe();
      liveFirstPageIdsRef.current = new Set();
    };
  }, [
    activeQueryKey,
    activeSection,
    currentUser?.id,
    feedReady,
    periodFilter,
    processDocuments,
    selectedSimulator,
    selectedSimulatorAliases,
    simulatorReady,
  ]);

  useEffect(() => {
    if (!feedReady) return;
    const cancelInitialLoad = scheduleIdleTask(() => void loadUnreadIndicators(), 800);
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void loadUnreadIndicators();
      void fetchPosts(false, true);

      if (Date.now() - companyCatalogRefreshAtRef.current >= 5 * 60 * 1000) {
        companyCatalogRefreshAtRef.current = Date.now();
        void loadCompanyCatalog(true)
          .catch((error) => {
            console.warn("[NVU NEWS] Atualização de empresas indisponível:", error);
          });
      }
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelInitialLoad();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [feedReady, fetchPosts, loadCompanyCatalog, loadUnreadIndicators]);

  useEffect(() => {
    const normalized = normalizeLookup(searchTerm);
    if (normalized.length < 3 || !currentUser?.id) {
      setSearching(false);
      if (remoteSearchActiveRef.current) {
        remoteSearchActiveRef.current = false;
        lastQueryKeyRef.current = activeQueryKey;
        const cached = activeQueryKey ? readFeedCache(activeQueryKey) : null;
        if (cached) {
          const hydratedPosts = sanitizeCachedPosts(cached.posts);
          if (activeSection === "noticias") warmCriticalNewsImages(hydratedPosts);
          postsRef.current = hydratedPosts;
          setPosts(hydratedPosts);
          cursorRef.current = memoryFeedCursors.get(activeQueryKey) || null;
          setHasMore(cached.hasMore);
          setLoading(false);
          initialLoadCompletedRef.current = true;
        }
        void fetchPosts(false, Boolean(cached));
      }
      return;
    }
    remoteSearchActiveRef.current = true;

    let canceled = false;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const token = normalized
          .split(" ")
          .filter(Boolean)
          .sort((left, right) => right.length - left.length)[0]
          ?.slice(0, 18);
        if (!token) return;

        const snapshot = await getDocs(query(
          collection(db, COLLECTIONS[activeSection]),
          where("searchTokens", "array-contains", token),
          limit(SEARCH_LIMIT),
        ));
        if (canceled) return;
        const results = processDocuments(snapshot.docs, activeSection, selectedSimulator, selectedSimulatorAliases)
          .filter((post) => activeSection !== "noticias" || postMatchesPeriod(post, periodFilter))
          .sort((left, right) => postTimestamp(right) - postTimestamp(left));
        postsRef.current = results;
        setPosts(results);
        setHasMore(false);
      } catch (error) {
        console.warn("[NVU NEWS] Pesquisa indisponível:", error);
      } finally {
        if (!canceled) setSearching(false);
      }
    }, 260);

    return () => {
      canceled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeSection,
    activeQueryKey,
    currentUser?.id,
    fetchPosts,
    periodFilter,
    processDocuments,
    sanitizeCachedPosts,
    searchTerm,
    selectedSimulator,
    selectedSimulatorAliases,
  ]);

  useEffect(() => {
    if (normalizeLookup(searchTerm).length >= 3 || !hasMore || loading || loadingMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void fetchPosts(true);
    }, { rootMargin: "420px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchPosts, hasMore, loading, loadingMore, searchTerm]);

  useEffect(() => {
    if (!activeQueryKey || !currentUser?.id || typeof window === "undefined") return;
    const userId = String(currentUser.id);
    const savePosition = () => {
      if (scrollSaveFrameRef.current !== null) return;
      scrollSaveFrameRef.current = window.requestAnimationFrame(() => {
        scrollSaveFrameRef.current = null;
        writeFeedScrollPosition(userId, activeQueryKey, window.scrollY);
      });
    };

    window.addEventListener("scroll", savePosition, { passive: true });
    return () => {
      window.removeEventListener("scroll", savePosition);
      if (scrollSaveFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollSaveFrameRef.current);
        scrollSaveFrameRef.current = null;
      }
      writeFeedScrollPosition(userId, activeQueryKey, window.scrollY);
    };
  }, [activeQueryKey, currentUser?.id]);

  useEffect(() => {
    if (
      !feedReady ||
      loading ||
      !activeQueryKey ||
      !currentUser?.id ||
      scrollRestoreKeyRef.current === activeQueryKey ||
      typeof window === "undefined"
    ) {
      return;
    }

    scrollRestoreKeyRef.current = activeQueryKey;
    const position = readFeedScrollPosition(String(currentUser.id), activeQueryKey);
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: position, behavior: "auto" });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [activeQueryKey, currentUser?.id, feedReady, loading, posts.length]);

  const filteredPosts = useMemo(() => {
    const normalized = normalizeLookup(searchTerm);
    const simulatorScoped = posts
      .filter(postMatchesSelectedSimulator)
      .filter((post) => activeSection !== "noticias" || postMatchesPeriod(post, periodFilter));
    if (!normalized || normalized.length >= 3) return simulatorScoped;
    return simulatorScoped.filter((post) => normalizeLookup([
      post.titulo,
      post.legenda,
      post.mensagem,
      post.simulador,
      post.periodo,
      post.empresaNome,
      post.proprietarioNome,
      ...(post.topEmpresas || []).map((item) => item.nome),
      ...(post.topMotoristas || []).flatMap((item) => [item.nome, item.empresaNome]),
    ].filter(Boolean).join(" ")).includes(normalized));
  }, [activeSection, periodFilter, postMatchesSelectedSimulator, posts, searchTerm]);

  const hydrateUpcomingVariant = useCallback((
    section: Section,
    period: PeriodFilter,
    simulator: string,
  ) => {
    if (!currentUser?.id) return;
    const key = feedCacheKey(String(currentUser.id), section, period, simulator || "all");
    const cached = readFeedCache(key);
    setFeedError(null);
    lastQueryKeyRef.current = "";
    requestRef.current += 1;
    cursorRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    prefetchedNextPagesRef.current.delete(key);
    if (cached) {
      const hydratedPosts = sanitizeCachedPosts(cached.posts);
      if (section === "noticias") warmCriticalNewsImages(hydratedPosts);
      postsRef.current = hydratedPosts;
      setPosts(hydratedPosts);
      cursorRef.current = memoryFeedCursors.get(key) || null;
      setHasMore(cached.hasMore);
      setLoading(false);
      initialLoadCompletedRef.current = true;
      setFeedReady(true);
    } else {
      postsRef.current = [];
      setPosts([]);
      setHasMore(true);
      setLoading(true);
      initialLoadCompletedRef.current = false;
    }
  }, [currentUser?.id, sanitizeCachedPosts]);

  const changeSection = (section: Section) => {
    if (section === activeSection) return;
    hydrateUpcomingVariant(section, "all", selectedSimulator || "all");
    setActiveSection(section);
    setSearchTerm("");
    setPeriodFilter("all");
  };

  const changePeriodFilter = (value: PeriodFilter) => {
    if (value === periodFilter) return;
    hydrateUpcomingVariant(activeSection, value, selectedSimulator || "all");
    setPeriodFilter(value);
  };

  const changeSimulator = (value: string) => {
    const normalizedValue = value || "all";
    simulatorSelectionModeRef.current = "user";
    setSimulatorReady(true);
    hydrateUpcomingVariant(activeSection, periodFilter, normalizedValue);
    setSelectedSimulator(normalizedValue);
  };

  return (
    <NewsFeedView
      activeSection={activeSection}
      periodFilter={periodFilter}
      filteredPosts={filteredPosts}
      loading={loading}
      loadingMore={loadingMore}
      refreshing={refreshing}
      searching={searching}
      hasMore={hasMore}
      historyPreparing={historyPreparing}
      feedError={feedError}
      searchTerm={searchTerm}
      selectedSimulator={selectedSimulator || "all"}
      simulatorOptions={simulatorOptions}
      activeSimulatorLabel={activeSimulatorLabel}
      sentinelRef={sentinelRef}
      sectionUnreadCounts={unreadCounts}
      onRefresh={() => {
        void fetchPosts(false).finally(() => void loadUnreadIndicators(true));
      }}
      onSectionChange={changeSection}
      onPeriodFilterChange={changePeriodFilter}
      onSearchChange={setSearchTerm}
      onSimulatorChange={changeSimulator}
      onLoadMore={() => void fetchPosts(true)}
    />
  );
}
