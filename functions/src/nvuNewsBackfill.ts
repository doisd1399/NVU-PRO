import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";
import { createHash } from "node:crypto";
import { syncCompanyApprovalNewsHistory } from "./companyApprovalNews";
import { requireActiveSenior } from "./seniorAccountCommands";
import {
  RANKING_TIME_ZONE,
  RANKING_PERIOD_POLICY,
  PUBLICATION_DELAY_MINUTES,
  dateKey as sharedDateKey,
  formatDatePt as sharedFormatDatePt,
  formatMonthPt as sharedFormatMonthPt,
  periodForDate as sharedPeriodForDate,
  periodFromKey as sharedPeriodFromKey,
  closedPeriodsInRange as sharedClosedPeriodsInRange,
  parseDate as sharedParseDate,
} from "./rankingCalendar";
import { publishedAtForCreate } from "./publicationPolicy";
import { resolveTripCurrency } from "./tripCurrencyResolver";

const db = admin.firestore();
const NEWS_TIME_ZONE = RANKING_TIME_ZONE;
const AUTOMATION_VERSION = "nvu_news_individual_v8_utc_global";
const HISTORY_VERSION = "nvu_news_recent_history_individual_v11_utc_global";
const RANKING_AGGREGATE_SCHEMA_VERSION = 6;
const CONTROL_DOCUMENT_ID = AUTOMATION_VERSION;
const CLASSIFICATIONS_COLLECTION = "nvu_classificacoes";
const COMMUNICATIONS_COLLECTION = "nvu_comunicados";
const TRIPS_COLLECTION = "historico_viagens";
const PAGE_SIZE = 500;
const RANGE_DATE_FIELDS = ["completedAt", "dataFechamento", "date", "dataLancamento", "createdAt"] as const;
const WRITE_BATCH_SIZE = 400;
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const HISTORY_LOOKBACK_DAYS = 70;
const FAILED_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const HISTORY_CHECKPOINT_VERSION = 5;

type PeriodType = "semana" | "mes";
type RankingEntity = "empresa" | "motorista";
type GenerationSource = "historico" | "automatico";
type HistoryStage =
  | "pending"
  | "classifications_written"
  | "company_approvals_written"
  | "legacy_classifications_removed"
  | "communications_migrated"
  | "completed";

type NormalizedTrip = {
  id: string;
  date: Date;
  value: number;
  amountCents: number;
  currency?: string;
  currencySource?: string;
  currencyInput: Record<string, unknown>;
  driverId: string;
  driverName: string;
  companyId: string;
  companyName: string;
  simulatorId: string;
  simulatorName: string;
};

type SimulatorDescriptor = {
  key: string;
  id: string;
  name: string;
  aliases: string[];
};

type SimulatorCatalog = {
  descriptors: SimulatorDescriptor[];
  byAlias: Map<string, string>;
  byId: Map<string, SimulatorDescriptor>;
  ids: Set<string>;
};

type PeriodDescriptor = {
  key: string;
  type: PeriodType;
  start: Date;
  end: Date;
  publicationAt: Date;
  label: string;
};

type Aggregate = {
  id: string;
  driverId: string;
  companyId: string;
  driverName: string;
  companyName: string;
  trips: number;
  earnings: number;
  earningsCents: number;
  currency: string;
  currencySourceCounts: Record<string, number>;
  reachedAt: Date;
  simulator: SimulatorDescriptor;
};

type PeriodGroup = {
  period: PeriodDescriptor;
  simulator: SimulatorDescriptor;
  companies: Map<string, Aggregate>;
  drivers: Map<string, Aggregate>;
};

type GeneratedDocument = {
  id: string;
  contentHash: string;
  data: Record<string, unknown>;
};

type WriteResult = {
  created: number;
  updated: number;
  ignored: number;
};

export type GenerationResult = {
  success: true;
  status: "completed" | "already_completed" | "in_progress";
  created: number;
  updated: number;
  ignored: number;
  migratedCommunications: number;
  sourceTrips: number;
  generationKey: string;
  historyVersion: string;
  removedLegacyClassifications: number;
};

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

function shortPersonName(value: unknown): string {
  const normalized = firstNonEmpty(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  const parts = normalized.split(" ");
  return parts.length <= 2 ? normalized : `${parts[0]} ${parts[parts.length - 1]}`;
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeSimulatorKey(value: unknown): string {
  const normalized = normalizeText(value).replace(/[^a-z0-9]/g, "");
  if (!normalized) return "nao-informado";
  if (normalized === "gto" || normalized.includes("globaltruckonline")) return "gto";
  if (normalized === "ets2" || normalized.includes("eurotrucksimulator2")) return "ets2";
  if (normalized === "ats" || normalized.includes("americantrucksimulator")) return "ats";
  if (normalized === "toe3" || normalized.includes("truckersofeurope3")) return "toe3";
  if (normalized === "wtds" || normalized.includes("worldtruckdrivingsimulator")) return "wtds";
  if (normalized === "wbds" || normalized.includes("worldbusdrivingsimulator")) return "wbds";
  if (normalized === "pbs" || normalized.includes("protonbussimulator")) return "pbs";
  return normalized;
}

function isUnsupportedSimulatorAlias(value: unknown): boolean {
  return normalizeText(value).replace(/[^a-z0-9]/g, "") === "grandtrucksimulator";
}

function hasUnsupportedSimulatorIdentity(
  data: FirebaseFirestore.DocumentData | undefined,
): boolean {
  if (!data) return false;
  return [
    data.simulatorName,
    data.simuladorNome,
    data.simulator,
    data.simulador,
    data.name,
    data.nome,
    data.label,
    data.title,
    data.displayName,
  ].some(isUnsupportedSimulatorAlias);
}

function simulatorCandidates(data: FirebaseFirestore.DocumentData | undefined): string[] {
  if (!data) return [];
  return [
    data.simulatorId,
    data.simuladorId,
    data.simulatorKey,
    data.simuladorKey,
    data.simulatorName,
    data.simuladorNome,
    data.simulator,
    data.simulador,
  ]
    .map((value) => firstNonEmpty(value))
    .filter(Boolean);
}

let simulatorCatalogCache: { expiresAt: number; value: SimulatorCatalog } | null = null;

async function loadSimulatorCatalog(): Promise<SimulatorCatalog> {
  if (simulatorCatalogCache && simulatorCatalogCache.expiresAt > Date.now()) {
    return simulatorCatalogCache.value;
  }

  const snapshot = await db.collection("simulators").get();
  const descriptors: SimulatorDescriptor[] = [];
  const byAlias = new Map<string, string>();
  const byId = new Map<string, SimulatorDescriptor>();
  const ids = new Set<string>();

  snapshot.docs.forEach((document) => {
    const data = document.data();
    if (hasUnsupportedSimulatorIdentity(data)) return;
    const id = document.id;
    const name = firstNonEmpty(
      data.name,
      data.nome,
      data.label,
      data.title,
      data.displayName,
      id,
    );
    const rawAliases = [
      id,
      name,
      data.code,
      data.slug,
      data.key,
      data.simulatorId,
      data.simuladorId,
      ...(Array.isArray(data.aliases) ? data.aliases : []),
    ]
      .map((value) => firstNonEmpty(value))
      .filter((value) => value && !isUnsupportedSimulatorAlias(value));
    const aliasSet = new Set<string>();
    rawAliases.forEach((value) => {
      [
        value,
        normalizeText(value).replace(/[^a-z0-9]/g, ""),
        normalizeSimulatorKey(value),
      ].filter(Boolean).forEach((alias) => aliasSet.add(alias));
    });
    const aliases = Array.from(aliasSet);
    const semanticKey = normalizeSimulatorKey(
      firstNonEmpty(data.code, data.slug, data.key, name, id),
    );
    const descriptor: SimulatorDescriptor = {
      id,
      name,
      key: semanticKey === "nao-informado" ? normalizeSimulatorKey(id) : semanticKey,
      aliases,
    };
    descriptors.push(descriptor);
    byId.set(id, descriptor);
    ids.add(id);
    aliases.forEach((alias) => {
      byAlias.set(alias, id);
      byAlias.set(normalizeText(alias).replace(/[^a-z0-9]/g, ""), id);
      byAlias.set(normalizeSimulatorKey(alias), id);
    });
  });

  const value = { descriptors, byAlias, byId, ids };
  simulatorCatalogCache = { expiresAt: Date.now() + 5 * 60 * 1000, value };
  return value;
}

function isEligibleCompany(company: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!company || Object.keys(company).length === 0) return false;
  if (hasUnsupportedSimulatorIdentity(company)) return false;
  const status = normalizeText(company.status || company.situacao || company.state || "active");
  const deleted =
    company.deleted === true ||
    company.softDeleted === true ||
    company.excluida === true ||
    company.excluido === true ||
    ["deleted", "excluida", "excluido", "removed", "removida", "removido"].includes(status);
  return !deleted && ["active", "approved", "ativo"].includes(status);
}

function parseTripValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;

  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    const lastDot = cleaned.lastIndexOf(".");
    normalized = cleaned.slice(0, lastDot).replace(/\./g, "") + cleaned.slice(lastDot);
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTripAmountCents(data: FirebaseFirestore.DocumentData): number {
  const rawCents = data.valorCents ?? data.amountCents ?? data.earningsCents;
  if (typeof rawCents === "number" && Number.isSafeInteger(rawCents)) return rawCents;
  if (typeof rawCents === "string" && /^-?\d+$/.test(rawCents.trim()) && Number.isSafeInteger(Number(rawCents))) return Number(rawCents);
  const decimal = [data.valor, data.value, data.totalValue, data.ganho]
    .find((value) => value !== null && value !== undefined && String(value).trim() !== "");
  return Math.round(parseTripValue(decimal) * 100);
}

const currencyInputFields = [
  "currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency",
  "currencyEvidenceVersion", "currencyEvidenceStatus", "currencyEvidenceSource", "serverValidatedAt",
  "simpleAutomation", "simpleReceiptCurrencySource", "gtoMoneySchemaVersion", "source", "automationSource",
  "simulatorId", "simuladorId", "simulatorKey", "simuladorKey", "simulator", "simulador",
  "simulatorCode", "simuladorCodigo", "simulatorName", "simuladorNome",
  "gtoRawText", "receiptText", "simpleReceiptText", "ocrText", "receiptOcrText",
] as const;

function parseDate(value: unknown): Date | null {
  return sharedParseDate(value);
}

function tripMetricDate(data: FirebaseFirestore.DocumentData): Date | null {
  return parseDate(
    data.completedAt ||
      data.dataFechamento ||
      data.date ||
      data.dataLancamento ||
      data.createdAt,
  );
}

function isValidCompletedTrip(data: FirebaseFirestore.DocumentData): boolean {
  const status = normalizeText(data.status);
  const canceled =
    ["cancelado", "cancelada", "canceled", "cancelled", "excluido", "excluida"].includes(status) ||
    data.cancelado === true ||
    data.deleted === true ||
    data.softDeleted === true;
  if (canceled) return false;

  if (["concluida", "concluido", "completed", "finalizado", "finalizada", "entregue"].includes(status)) {
    return true;
  }

  return !status && Boolean(
    data.completedAt || data.dataFechamento || data.dataLancamento || data.date || data.createdAt,
  );
}

function normalizeTrip(
  document: FirebaseFirestore.QueryDocumentSnapshot,
  rangeStart: Date,
  rangeEnd: Date,
): NormalizedTrip | null {
  const data = document.data();
  if (!isValidCompletedTrip(data)) return null;
  const date = tripMetricDate(data);
  if (!date || date.getTime() < rangeStart.getTime() || date.getTime() > rangeEnd.getTime()) return null;

  const driverId = firstNonEmpty(data.motoristaId, data.driverId, data.motorista_id, data.userId, data.driver_id);
  const companyId = firstNonEmpty(data.empresaId, data.companyId, data.company_id, data.empresa_id);
  if (!driverId || !companyId) return null;
  const amountCents = Math.max(0, parseTripAmountCents(data));
  const currencyInput = Object.fromEntries(currencyInputFields
    .filter((field) => data[field] !== undefined)
    .map((field) => [field, data[field]]));

  return {
    id: document.id,
    date,
    value: amountCents / 100,
    amountCents,
    currencyInput,
    driverId,
    driverName: firstNonEmpty(data.motoristaNome, data.driverName, data.motorista_nome, data.nomeMotorista, data.driver_name),
    companyId,
    companyName: firstNonEmpty(data.empresaNome, data.companyName, data.empresa_nome, data.fleetName),
    simulatorId: firstNonEmpty(data.simulatorId, data.simuladorId, data.simulator_id, data.simulador_id),
    simulatorName: firstNonEmpty(data.simulatorName, data.simuladorNome, data.simulador, data.simulator),
  };
}

function dateKey(date: Date): string {
  return sharedDateKey(date);
}

function formatDatePt(date: Date): string {
  return sharedFormatDatePt(date);
}

function formatMonthPt(date: Date): string {
  return sharedFormatMonthPt(date);
}

function periodForDate(date: Date, type: PeriodType, now: Date): PeriodDescriptor | null {
  return sharedPeriodForDate(date, type, now) as PeriodDescriptor | null;
}

function simulatorOf(
  trip: NormalizedTrip,
  company: FirebaseFirestore.DocumentData | undefined,
  catalog: SimulatorCatalog,
): SimulatorDescriptor | null {
  if (hasUnsupportedSimulatorIdentity(company)) return null;

  // The current company catalog is authoritative. Trip snapshots are used
  // only as a compatibility fallback for old records whose company document
  // does not contain a usable simulator identity.
  const candidates = [
    ...simulatorCandidates(company),
    trip.simulatorId,
    trip.simulatorName,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isUnsupportedSimulatorAlias(candidate)) continue;
    const direct = catalog.byId.get(candidate);
    if (direct) return direct;
    const rawKey = normalizeText(candidate).replace(/[^a-z0-9]/g, "");
    const resolvedId = catalog.byAlias.get(candidate) ||
      catalog.byAlias.get(rawKey) ||
      catalog.byAlias.get(normalizeSimulatorKey(candidate));
    if (resolvedId) return catalog.byId.get(resolvedId) || null;
  }

  return null;
}

async function loadDocumentsByIds(
  collectionName: string,
  ids: string[],
  cache: Map<string, FirebaseFirestore.DocumentData>,
): Promise<void> {
  const missing = Array.from(new Set(ids.filter(Boolean))).filter((id) => !cache.has(id));
  const chunkSize = 250;
  for (let offset = 0; offset < missing.length; offset += chunkSize) {
    const chunk = missing.slice(offset, offset + chunkSize);
    const snapshots = await db.getAll(...chunk.map((id) => db.collection(collectionName).doc(id)));
    snapshots.forEach((snapshot) => {
      cache.set(snapshot.id, snapshot.exists ? snapshot.data() || {} : {});
    });
  }
}

function addAggregate(
  map: Map<string, Aggregate>,
  key: string,
  trip: NormalizedTrip,
  entity: "empresa" | "motorista",
  simulator: SimulatorDescriptor,
): void {
  const current = map.get(key) || {
    id: key,
    driverId: entity === "motorista" ? trip.driverId : "",
    companyId: trip.companyId,
    driverName: entity === "motorista" ? trip.driverName : "",
    companyName: trip.companyName,
    trips: 0,
    earnings: 0,
    earningsCents: 0,
    currency: trip.currency!,
    currencySourceCounts: {},
    reachedAt: trip.date,
    simulator,
  };

  if (!trip.currency || current.currency !== trip.currency) return;
  const nextEarningsCents = current.earningsCents + trip.amountCents;
  if (!Number.isSafeInteger(nextEarningsCents)) return;
  current.trips += 1;
  current.earningsCents = nextEarningsCents;
  current.earnings = nextEarningsCents / 100;
  const currencySource = trip.currencySource || "UNKNOWN";
  current.currencySourceCounts[currencySource] = (current.currencySourceCounts[currencySource] || 0) + 1;
  if (!current.driverName && trip.driverName) current.driverName = trip.driverName;
  if (!current.companyName && trip.companyName) current.companyName = trip.companyName;
  if (trip.date.getTime() >= current.reachedAt.getTime()) {
    current.reachedAt = trip.date;
    if (entity === "motorista") {
      current.companyId = trip.companyId;
      if (trip.companyName) current.companyName = trip.companyName;
    }
  }
  map.set(key, current);
}

function compareRanking(left: Aggregate, right: Aggregate): number {
  return right.earnings - left.earnings ||
    right.trips - left.trips ||
    firstNonEmpty(left.driverName, left.companyName).localeCompare(
      firstNonEmpty(right.driverName, right.companyName),
      "pt-BR",
      { sensitivity: "base", numeric: true },
    ) ||
    left.id.localeCompare(right.id);
}

function buildSearchTokens(...values: unknown[]): string[] {
  const tokens = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeText(value)
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return;
    if (normalized.length <= 120) tokens.add(normalized);
    normalized.split(" ").filter(Boolean).forEach((word) => {
      tokens.add(word);
      for (let length = 3; length <= word.length && length <= 18; length += 1) {
        tokens.add(word.slice(0, length));
      }
    });
  });
  return Array.from(tokens).slice(0, 160);
}

function companyNameOf(aggregate: Aggregate, company: FirebaseFirestore.DocumentData | undefined): string {
  return firstNonEmpty(company?.companyName, company?.fleetName, company?.name, aggregate.companyName, "Empresa NVU");
}

function companyLogoOf(company: FirebaseFirestore.DocumentData | undefined): string {
  return firstNonEmpty(
    company?.logoUrl,
    company?.logoURL,
    company?.companyLogoURL,
    company?.companyLogoUrl,
    company?.company_logo_url,
    company?.logo,
    company?.logoEmpresa,
    company?.logo_empresa,
    company?.imageUrl,
    company?.avatar,
  );
}

function driverNameOf(aggregate: Aggregate, user: FirebaseFirestore.DocumentData | undefined): string {
  return shortPersonName(firstNonEmpty(user?.name, user?.fullName, user?.displayName, aggregate.driverName, "Motorista NVU"));
}

function driverPhotoOf(user: FirebaseFirestore.DocumentData | undefined): string {
  return firstNonEmpty(
    user?.profilePhotoURL,
    user?.profilePhotoUrl,
    user?.photoURL,
    user?.photoUrl,
    user?.applicationPhotoURL,
    user?.applicationPhotoUrl,
    user?.authPhotoURL,
    user?.avatarUrl,
    user?.avatar,
    user?.profileImage,
    user?.imageUrl,
  );
}

async function aggregateTrips(
  rangeStart: Date,
  rangeEnd: Date,
  periodTypes: PeriodType[],
): Promise<{ groups: Map<string, PeriodGroup>; sourceTrips: number; companies: Map<string, FirebaseFirestore.DocumentData> }> {
  const groups = new Map<string, PeriodGroup>();
  const companyCache = new Map<string, FirebaseFirestore.DocumentData>();
  const simulatorCatalog = await loadSimulatorCatalog();
  const now = new Date();
  const seenTripIds = new Set<string>();
  let sourceTrips = 0;

  const processDocuments = async (
    documents: FirebaseFirestore.QueryDocumentSnapshot[],
  ): Promise<void> => {
    const uniqueDocuments = documents.filter((document) => {
      if (seenTripIds.has(document.id)) return false;
      seenTripIds.add(document.id);
      return true;
    });

    const trips = uniqueDocuments
      .map((document) => normalizeTrip(document, rangeStart, rangeEnd))
      .filter((trip): trip is NormalizedTrip => Boolean(trip));
    sourceTrips += trips.length;

    await loadDocumentsByIds("frotas", trips.map((trip) => trip.companyId), companyCache);

    trips.forEach((trip) => {
      const company = companyCache.get(trip.companyId);
      // A viagem permanece no histórico, mas uma empresa removida não pode
      // reaparecer em classificações antigas ou futuras.
      if (!isEligibleCompany(company)) return;
      const simulator = simulatorOf(trip, company, simulatorCatalog);
      if (!simulator || !simulator.key || simulator.key === "nao-informado") return;
      const currencyInput: Record<string, unknown> = { ...trip.currencyInput };
      const simulatorAliases = Array.from(new Set([simulator.key, simulator.name, ...simulator.aliases].filter(Boolean)));
      const simulatorIdentityFields = ["simulatorCode", "simulatorName", "simulatorKey", "simulator", "simuladorCodigo", "simuladorNome", "simuladorKey", "simulador", "gameCode", "packageId"];
      simulatorAliases.forEach((alias) => {
        const emptyField = simulatorIdentityFields.find((field) => !String(currencyInput[field] ?? "").trim());
        if (emptyField) currencyInput[emptyField] = alias;
      });
      const currencyResolution = resolveTripCurrency(currencyInput);
      if (currencyResolution.currencyStatus !== "known" || !currencyResolution.currency) return;
      const rankingTrip: NormalizedTrip = {
        ...trip,
        value: trip.amountCents / 100,
        currency: currencyResolution.currency,
        currencySource: currencyResolution.currencySource || "UNKNOWN",
      };

      periodTypes.forEach((periodType) => {
        const period = periodForDate(trip.date, periodType, now);
        if (!period) return;
        const groupKey = `${period.key}_${simulator.key}_${currencyResolution.currency}`;
        const group = groups.get(groupKey) || {
          period,
          simulator,
          companies: new Map<string, Aggregate>(),
          drivers: new Map<string, Aggregate>(),
        };
        addAggregate(group.companies, trip.companyId, rankingTrip, "empresa", simulator);
        addAggregate(group.drivers, trip.driverId, rankingTrip, "motorista", simulator);
        groups.set(groupKey, group);
      });
    });
  };

  const lowerBound = admin.firestore.Timestamp.fromDate(rangeStart);
  const upperBound = admin.firestore.Timestamp.fromDate(rangeEnd);

  // Historical and scheduled generation are always bounded by a date range.
  // This prevents any accidental full scan of historico_viagens. Legacy date
  // aliases remain supported and duplicate documents are removed by id.
  for (const field of RANGE_DATE_FIELDS) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    do {
      let pageQuery: FirebaseFirestore.Query = db.collection(TRIPS_COLLECTION)
        .where(field, ">=", lowerBound)
        .where(field, "<=", upperBound)
        .orderBy(field)
        .limit(PAGE_SIZE);
      if (cursor) pageQuery = pageQuery.startAfter(cursor);

      const snapshot = await pageQuery.get();
      if (snapshot.empty) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
      await processDocuments(snapshot.docs);
      if (snapshot.size < PAGE_SIZE) break;
    } while (cursor);
  }

  return { groups, sourceTrips, companies: companyCache };
}

function entityLabel(entity: RankingEntity): string {
  return entity === "empresa" ? "empresas" : "motoristas";
}

function monthTitleLabel(date: Date): string {
  const label = new Intl.DateTimeFormat("pt-BR", {
    timeZone: NEWS_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(date);
  return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
}

function periodTitleSegment(group: PeriodGroup): string {
  if (group.period.type === "semana") return "semana";
  return `mês de ${monthTitleLabel(group.period.start)}`;
}
function titleForEntity(group: PeriodGroup, entity: RankingEntity, count: number): string {
  const period = periodTitleSegment(group);
  const entityPlural = entityLabel(entity);
  if (count === 1) {
    return group.period.type === "mes"
      ? `Fim da temporada mensal — ${monthTitleLabel(group.period.start)}`
      : "Fim da temporada semanal";
  }
  if (count === 2) return `2 ${entityPlural} em destaque no ${period} — ${group.simulator.name}`;
  return `3 melhores ${entityPlural} do ${period} — ${group.simulator.name}`;
}

function formatCurrency(value: unknown, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) return "moeda não resolvida";
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function captionVariation(
  variant: number,
  group: PeriodGroup,
  entity: RankingEntity,
  leaderName: string,
  count: number,
  leader: Record<string, unknown>,
): string {
  const periodLabel = group.period.type === "semana" ? "semanal" : "mensal";
  const period = group.period.label;
  const simulator = group.simulator.name;
  const entityPlural = entityLabel(entity);
  const subject = entity === "empresa" ? `A ${leaderName}` : leaderName;
  if (count === 1) {
    const subjectLabel = entity === "empresa" ? "a empresa" : "o motorista";
    return `Sem concorrentes no período, ${subjectLabel} gerou ${formatCurrency(leader.ganhos, String(leader.currency || ""))} em ganhos e realizou ${Number(leader.viagens || 0)} viagens.`;
  }

  const podium = count >= 3
    ? `Confira o pódio com as três melhores ${entityPlural}.`
    : count === 2
      ? `Confira os dois destaques que atenderam aos critérios do período.`
      : `O resultado apresenta o destaque elegível do período.`;

  const captions = [
    `A classificação ${periodLabel} de ${entityPlural} do ${simulator} está definida. ${subject} alcançou a liderança entre ${period}. ${podium}`,
    `Uma nova classificação foi concluída na NVU. ${subject} ocupou a primeira posição entre ${entityPlural} no ${simulator}. O resultado considera as viagens válidas de ${period}.`,
    `A NVU apresenta os destaques ${periodLabel === "semanal" ? "da semana" : "do mês"} entre ${entityPlural}. ${subject} encerrou o período na liderança do ${simulator}. ${podium}`,
    `O período ${period} chegou ao fim com uma nova classificação de ${entityPlural}. ${subject} conquistou o melhor desempenho válido no ${simulator}.`,
    `A NVU divulga o resultado ${periodLabel} de ${entityPlural} do ${simulator}. ${subject} ficou na primeira posição, representando o principal desempenho registrado em ${period}.`,
  ];
  return captions[variant % captions.length];
}

function contentDigest(data: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

async function buildGeneratedDocuments(
  groups: Map<string, PeriodGroup>,
  companies: Map<string, FirebaseFirestore.DocumentData>,
  source: GenerationSource,
): Promise<GeneratedDocument[]> {
  const winnerDriverIds = new Set<string>();
  const winnerCompanyIds = new Set<string>();

  groups.forEach((group) => {
    Array.from(group.companies.values())
      .filter((entry) => entry.earnings > 0 && entry.trips > 0 && isEligibleCompany(companies.get(entry.companyId)))
      .sort(compareRanking)
      .slice(0, 3)
      .forEach((entry) => winnerCompanyIds.add(entry.companyId));
    Array.from(group.drivers.values())
      .filter((entry) => entry.earnings > 0 && entry.trips > 0 && isEligibleCompany(companies.get(entry.companyId)))
      .sort(compareRanking)
      .slice(0, 3)
      .forEach((entry) => {
        winnerDriverIds.add(entry.driverId);
        winnerCompanyIds.add(entry.companyId);
      });
  });

  await loadDocumentsByIds("frotas", Array.from(winnerCompanyIds), companies);
  const users = new Map<string, FirebaseFirestore.DocumentData>();
  await loadDocumentsByIds("users", Array.from(winnerDriverIds), users);

  const generated: GeneratedDocument[] = [];
  groups.forEach((group) => {
    const companyRanking = Array.from(group.companies.values())
      .filter((entry) => entry.earnings > 0 && entry.trips > 0 && isEligibleCompany(companies.get(entry.companyId)))
      .sort(compareRanking)
      .slice(0, 3);
    const driverRanking = Array.from(group.drivers.values())
      .filter((entry) => entry.earnings > 0 && entry.trips > 0 && isEligibleCompany(companies.get(entry.companyId)))
      .sort(compareRanking)
      .slice(0, 3);

    const topEmpresas = companyRanking.map((entry, index) => ({
      posicao: index + 1,
      id: entry.companyId,
      nome: companyNameOf(entry, companies.get(entry.companyId)),
      logo: companyLogoOf(companies.get(entry.companyId)),
      ganhos: Math.round(entry.earnings * 100) / 100,
      currency: entry.currency,
      moeda: entry.currency,
      currencySourceCounts: entry.currencySourceCounts,
      viagens: entry.trips,
    }));

    const topMotoristas = driverRanking.map((entry, index) => ({
      posicao: index + 1,
      id: entry.driverId,
      nome: driverNameOf(entry, users.get(entry.driverId)),
      foto: driverPhotoOf(users.get(entry.driverId)),
      empresaId: entry.companyId,
      empresaNome: companyNameOf(entry, companies.get(entry.companyId)),
      empresaLogo: companyLogoOf(companies.get(entry.companyId)),
      ganhos: Math.round(entry.earnings * 100) / 100,
      currency: entry.currency,
      moeda: entry.currency,
      currencySourceCounts: entry.currencySourceCounts,
      viagens: entry.trips,
    }));

    const publishEntity = (
      entity: RankingEntity,
      entries: Array<Record<string, unknown>>,
      sortOffsetMs: number,
    ) => {
      if (entries.length === 0) return;
      const variantSeed = createHash("sha256")
        .update(`${group.period.key}_${group.simulator.key}_${entity}`)
        .digest()[0];
      const legendaModelo = variantSeed % 5;
      const leaderName = firstNonEmpty(entries[0]?.nome, entity === "empresa" ? "Empresa NVU" : "Motorista NVU");
      const titulo = titleForEntity(group, entity, entries.length);
      const legenda = captionVariation(legendaModelo, group, entity, leaderName, entries.length, entries[0]);
      // A versão global usa IDs próprios: a primeira execução nunca deve
      // atualizar nem colidir com os documentos históricos SP/legados.
      const documentId = `classificacao_${AUTOMATION_VERSION}_${group.period.type}_${entity}_${group.simulator.key}_${dateKey(group.period.start)}`;
      const entityEntries = entity === "empresa" ? { topEmpresas: entries, topMotoristas: [] } : { topEmpresas: [], topMotoristas: entries };

      const stableData: Record<string, unknown> = {
        schemaVersion: AUTOMATION_VERSION,
        secao: "noticias",
        tipo: "classificacao",
        categoria: "classificacao",
        entidade: entity,
        periodicidade: group.period.type,
        periodoTipo: group.period.type,
        titulo,
        legenda,
        legendaModelo: legendaModelo + 1,
        simuladorId: group.simulator.id,
        simulador: group.simulator.name,
        simuladorKey: group.simulator.key,
        periodo: group.period.label,
        periodoInicioKey: dateKey(group.period.start),
        periodoFimKey: dateKey(group.period.end),
        periodPolicy: RANKING_PERIOD_POLICY,
        periodTimeZone: RANKING_TIME_ZONE,
        periodStartUtc: group.period.start.toISOString(),
        periodEndUtc: group.period.end.toISOString(),
        calculationVersion: AUTOMATION_VERSION,
        ...entityEntries,
        totalClassificados: entries.length,
        semConcorrentes: entries.length === 1,
        formatoPublicacao: entries.length === 1 ? "fim_temporada" : "classificacao",
        origem: source,
        historico: source === "historico",
        status: "publicado",
        visibilidade: "publico",
        createdBySystem: true,
        dedupeKey: documentId,
        searchTokens: buildSearchTokens(
          titulo,
          legenda,
          group.simulator.name,
          group.period.label,
          entity,
          ...entries.map((item) => item.nome),
          ...entries.map((item) => item.empresaNome),
        ),
      };
      const contentHash = contentDigest(stableData);

      generated.push({
        id: documentId,
        contentHash,
        data: {
          ...stableData,
          contentHash,
          periodoInicio: admin.firestore.Timestamp.fromDate(group.period.start),
          periodoFim: admin.firestore.Timestamp.fromDate(group.period.end),
          dataReferencia: admin.firestore.Timestamp.fromDate(group.period.end),
          periodStartUtc: admin.firestore.Timestamp.fromDate(group.period.start),
          periodEndUtc: admin.firestore.Timestamp.fromDate(group.period.end),
          sortAt: admin.firestore.Timestamp.fromDate(new Date(group.period.publicationAt.getTime() + sortOffsetMs)),
          publicacaoProgramadaEm: admin.firestore.Timestamp.fromDate(new Date(group.period.publicationAt.getTime() + sortOffsetMs)),
        },
      });
    };

    // Os dois rankings viram notícias independentes, inclusive no histórico.
    publishEntity("empresa", topEmpresas, 0);
    publishEntity("motorista", topMotoristas, 60_000);
  });

  return generated.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function periodIdentity(period: PeriodDescriptor): string {
  return `${period.type}:${dateKey(period.start)}`;
}

function uniquePeriods(periods: PeriodDescriptor[]): PeriodDescriptor[] {
  const byIdentity = new Map<string, PeriodDescriptor>();
  periods.forEach((period) => byIdentity.set(periodIdentity(period), period));
  return Array.from(byIdentity.values()).sort(
    (left, right) => left.start.getTime() - right.start.getTime() ||
      left.type.localeCompare(right.type),
  );
}

function closedPeriodsInRange(
  rangeStart: Date,
  rangeEnd: Date,
  periodTypes: PeriodType[],
  now = new Date(),
): PeriodDescriptor[] {
  return sharedClosedPeriodsInRange(rangeStart, rangeEnd, periodTypes, now) as PeriodDescriptor[];
}

async function deleteUnexpectedSystemClassifications(
  periods: PeriodDescriptor[],
  expectedIds: Set<string>,
  simulatorScope?: SimulatorDescriptor,
): Promise<number> {
  let removed = 0;
  for (const period of uniquePeriods(periods)) {
    const snapshot = await db.collection(CLASSIFICATIONS_COLLECTION)
      .where("periodoInicioKey", "==", dateKey(period.start))
      .get();
    const stale = snapshot.docs.filter((document) => {
      const data = document.data() || {};
      const periodType = firstNonEmpty(data.periodoTipo, data.periodicidade);
      const matchesSimulator = !simulatorScope ||
        firstNonEmpty(data.simuladorId) === simulatorScope.id ||
        normalizeSimulatorKey(data.simuladorKey || data.simulador) === simulatorScope.key;
      return data.createdBySystem === true &&
        data.schemaVersion === AUTOMATION_VERSION &&
        data.tipo === "classificacao" &&
        periodType === period.type &&
        matchesSimulator &&
        !expectedIds.has(document.id);
    });

    for (let offset = 0; offset < stale.length; offset += WRITE_BATCH_SIZE) {
      const batch = db.batch();
      stale.slice(offset, offset + WRITE_BATCH_SIZE).forEach((document) => {
        batch.delete(document.ref);
      });
      await batch.commit();
      removed += Math.min(WRITE_BATCH_SIZE, stale.length - offset);
    }
  }
  return removed;
}

async function reconcileClosedPeriods(
  periods: PeriodDescriptor[],
  source: GenerationSource,
): Promise<WriteResult & { removed: number; sourceTrips: number; generated: number }> {
  const canonicalPeriods = uniquePeriods(periods).filter(
    (period) => period.publicationAt.getTime() <= Date.now(),
  );
  if (canonicalPeriods.length === 0) {
    return {
      created: 0,
      updated: 0,
      ignored: 0,
      removed: 0,
      sourceTrips: 0,
      generated: 0,
    };
  }

  const rangeStart = new Date(
    Math.min(...canonicalPeriods.map((period) => period.start.getTime())),
  );
  const rangeEnd = new Date(
    Math.max(...canonicalPeriods.map((period) => period.end.getTime())),
  );
  const periodTypes = Array.from(
    new Set(canonicalPeriods.map((period) => period.type)),
  );
  const expectedPeriodIds = new Set(canonicalPeriods.map(periodIdentity));
  const aggregated = await aggregateTrips(rangeStart, rangeEnd, periodTypes);
  const selectedGroups = new Map(
    Array.from(aggregated.groups.entries()).filter(([, group]) =>
      expectedPeriodIds.has(periodIdentity(group.period)),
    ),
  );
  const generated = await buildGeneratedDocuments(
    selectedGroups,
    aggregated.companies,
    source,
  );
  const writeResult = await commitDocuments(CLASSIFICATIONS_COLLECTION, generated, {
    stampPublishedAtOnCreate: source === "automatico",
  });
  const removed = await deleteUnexpectedSystemClassifications(
    canonicalPeriods,
    new Set(generated.map((document) => document.id)),
  );
  return {
    ...writeResult,
    removed,
    sourceTrips: aggregated.sourceTrips,
    generated: generated.length,
  };
}

function periodFromRankingAggregate(
  data: FirebaseFirestore.DocumentData,
): PeriodDescriptor | null {
  const type = firstNonEmpty(data.periodType) as PeriodType;
  if (!( ["semana", "mes"] as string[]).includes(type)) return null;
  if (
    firstNonEmpty(data.periodTimeZone) !== NEWS_TIME_ZONE ||
    firstNonEmpty(data.periodPolicy) !== RANKING_PERIOD_POLICY
  ) return null;

  const periodKey = firstNonEmpty(data.periodKey);
  const canonical = sharedPeriodFromKey(type, periodKey);
  const start = parseDate(data.periodStartUtc || data.periodStart);
  const end = parseDate(data.periodEndUtc || data.periodEnd);
  if (!canonical || !start || !end) return null;
  if (
    start.getTime() !== canonical.start.getTime() ||
    end.getTime() !== canonical.end.getTime()
  ) return null;

  const publicationAt = new Date(
    end.getTime() + 1 + PUBLICATION_DELAY_MINUTES * 60 * 1000,
  );
  return {
    key: periodKey,
    type,
    start,
    end,
    publicationAt,
    label: type === "mes"
      ? formatMonthPt(start)
      : `${formatDatePt(start)} a ${formatDatePt(end)}`,
  };
}

function safeRankingCurrencyAggregate(
  raw: FirebaseFirestore.DocumentData,
  tripCount: number,
): { comparable: boolean; currency: string; earningsCents: number; currencySourceCounts: Record<string, number> } {
  const totals = raw?.currencyTotals && typeof raw.currencyTotals === "object" && !Array.isArray(raw.currencyTotals)
    ? raw.currencyTotals as Record<string, unknown>
    : {};
  const counts = raw?.currencyTripCounts && typeof raw.currencyTripCounts === "object" && !Array.isArray(raw.currencyTripCounts)
    ? raw.currencyTripCounts as Record<string, unknown>
    : {};
  const currencies = Array.from(new Set([...Object.keys(totals), ...Object.keys(counts)])).filter((currency) => /^[A-Z]{3}$/.test(currency));
  if (currencies.length !== 1) return { comparable: false, currency: "", earningsCents: 0, currencySourceCounts: {} };

  const currency = currencies[0]!;
  const unresolvedTrips = Math.max(0, Math.trunc(Number(raw?.currencyUnresolvedTrips) || 0));
  const missingValueTrips = Math.max(0, Math.trunc(Number(raw?.currencyMissingValueTrips) || 0));
  const currencyTrips = Math.max(0, Math.trunc(Number(counts[currency]) || 0));
  const rawEarnings = Number(totals[currency]);
  const earningsCents = Math.round(rawEarnings * 100);
  const comparable = tripCount > 0 && currencyTrips === tripCount && unresolvedTrips === 0 && missingValueTrips === 0 &&
    Number.isFinite(rawEarnings) && rawEarnings >= 0 && Number.isSafeInteger(earningsCents);
  const sourceCounts = raw?.currencySourceCounts && typeof raw.currencySourceCounts === "object" && !Array.isArray(raw.currencySourceCounts)
    ? Object.fromEntries(Object.entries(raw.currencySourceCounts as Record<string, unknown>)
        .map(([source, count]) => [source, Math.max(0, Math.trunc(Number(count) || 0))]))
    : {};
  return {
    comparable,
    currency: comparable ? currency : "",
    earningsCents: comparable ? earningsCents : 0,
    currencySourceCounts: comparable ? sourceCounts : {},
  };
}

async function reconcileFromRankingAggregate(
  data: FirebaseFirestore.DocumentData,
): Promise<void> {
  if (
    Number(data.schemaVersion) !== RANKING_AGGREGATE_SCHEMA_VERSION ||
    data.complete !== true
  ) return;
  const period = periodFromRankingAggregate(data);
  if (!period || period.publicationAt.getTime() > Date.now()) return;

  const simulatorId = firstNonEmpty(data.simulatorId);
  const catalog = await loadSimulatorCatalog();
  const simulator = catalog.byId.get(simulatorId);
  if (!simulator) return;

  const group: PeriodGroup = {
    period,
    simulator,
    companies: new Map<string, Aggregate>(),
    drivers: new Map<string, Aggregate>(),
  };
  const companyStats = data.companies && typeof data.companies === "object"
    ? data.companies as Record<string, FirebaseFirestore.DocumentData>
    : {};
  const driverStats = data.drivers && typeof data.drivers === "object"
    ? data.drivers as Record<string, FirebaseFirestore.DocumentData>
    : {};

  Object.entries(companyStats).forEach(([companyId, raw]) => {
    const trips = Math.max(0, Math.trunc(Number(raw?.trips) || 0));
    const safeMoney = safeRankingCurrencyAggregate(raw, trips);
    group.companies.set(companyId, {
      id: companyId,
      driverId: "",
      companyId,
      driverName: "",
      companyName: firstNonEmpty(raw?.name),
      trips: safeMoney.comparable ? trips : 0,
      earnings: safeMoney.earningsCents / 100,
      earningsCents: safeMoney.earningsCents,
      currency: safeMoney.currency,
      currencySourceCounts: safeMoney.currencySourceCounts,
      reachedAt: period.end,
      simulator,
    });
  });
  Object.entries(driverStats).forEach(([driverId, raw]) => {
    const companyId = firstNonEmpty(raw?.companyId);
    if (!companyId) return;
    const trips = Math.max(0, Math.trunc(Number(raw?.trips) || 0));
    const safeMoney = safeRankingCurrencyAggregate(raw, trips);
    group.drivers.set(driverId, {
      id: driverId,
      driverId,
      companyId,
      driverName: firstNonEmpty(raw?.name),
      companyName: "",
      trips: safeMoney.comparable ? trips : 0,
      earnings: safeMoney.earningsCents / 100,
      earningsCents: safeMoney.earningsCents,
      currency: safeMoney.currency,
      currencySourceCounts: safeMoney.currencySourceCounts,
      reachedAt: period.end,
      simulator,
    });
  });

  const companies = new Map<string, FirebaseFirestore.DocumentData>();
  await loadDocumentsByIds(
    "frotas",
    Array.from(new Set([
      ...group.companies.keys(),
      ...Array.from(group.drivers.values()).map((entry) => entry.companyId),
    ])),
    companies,
  );
  const generated = await buildGeneratedDocuments(
    new Map([[`${periodIdentity(period)}:${simulator.key}`, group]]),
    companies,
    "automatico",
  );
  await commitDocuments(CLASSIFICATIONS_COLLECTION, generated, {
    stampPublishedAtOnCreate: true,
  });
  await deleteUnexpectedSystemClassifications(
    [period],
    new Set(generated.map((document) => document.id)),
    simulator,
  );
}

function closedPeriodsForTripData(
  data: FirebaseFirestore.DocumentData | undefined,
): PeriodDescriptor[] {
  if (!data) return [];
  const date = tripMetricDate(data);
  if (!date) return [];
  const now = new Date();
  return (["semana", "mes"] as PeriodType[])
    .map((type) => periodForDate(date, type, now))
    .filter((period): period is PeriodDescriptor => Boolean(period));
}

function companyClassificationSignature(
  data: FirebaseFirestore.DocumentData | undefined,
): string {
  if (!data) return "missing";
  return [
    data.status,
    data.situacao,
    data.state,
    data.deleted,
    data.softDeleted,
    data.excluida,
    data.excluido,
    data.simulatorId,
    data.simuladorId,
    data.simulatorName,
    data.simuladorNome,
    data.companyName,
    data.fleetName,
    data.name,
    data.logoUrl,
    data.logoURL,
    data.companyLogoURL,
  ].map((value) => String(value ?? "").trim()).join("|");
}

async function commitDocuments(
  collectionName: string,
  documents: GeneratedDocument[],
  options: { stampPublishedAtOnCreate?: boolean } = {},
): Promise<WriteResult> {
  let created = 0;
  let updated = 0;
  let ignored = 0;

  for (let offset = 0; offset < documents.length; offset += WRITE_BATCH_SIZE) {
    const chunk = documents.slice(offset, offset + WRITE_BATCH_SIZE);
    const refs = chunk.map((item) => db.collection(collectionName).doc(item.id));
    const snapshots = await db.getAll(...refs);
    const batch = db.batch();
    let hasWrites = false;

    snapshots.forEach((snapshot, index) => {
      const item = chunk[index];
      if (!snapshot.exists) {
        batch.create(refs[index], {
          ...item.data,
          ...publishedAtForCreate(
            snapshot.exists,
            options.stampPublishedAtOnCreate === true,
            admin.firestore.FieldValue.serverTimestamp(),
          ),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        created += 1;
        hasWrites = true;
        return;
      }

      const current = snapshot.data() || {};
      if (current.contentHash === item.contentHash && current.status === "publicado") {
        ignored += 1;
        return;
      }

      batch.set(refs[index], {
        ...item.data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      updated += 1;
      hasWrites = true;
    });

    if (hasWrites) await batch.commit();
  }

  return { created, updated, ignored };
}


async function deleteLegacyCombinedClassifications(
  recentRangeStart?: Date,
): Promise<number> {
  let removed = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  do {
    let page: FirebaseFirestore.Query = db.collection(CLASSIFICATIONS_COLLECTION)
      .where("tipo", "==", "classificacao")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(WRITE_BATCH_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    if (snapshot.empty) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];

    const legacyDocs = snapshot.docs.filter((document) => {
      const data = document.data() || {};
      if (data.tipo !== "classificacao") return false;

      const isLegacyCombined = !["empresa", "motorista"].includes(data.entidade);
      // During the global UTC rollout, no historical classification may be
      // deleted automatically. Old combined or SP documents remain available
      // for independent review and are never treated as duplicates by ID.
      void isLegacyCombined;
      void recentRangeStart;
      return false;
    });
    if (legacyDocs.length > 0) {
      const batch = db.batch();
      legacyDocs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      removed += legacyDocs.length;
    }
    if (snapshot.size < WRITE_BATCH_SIZE) break;
  } while (cursor);

  return removed;
}

async function migrateLegacyCommunications(): Promise<number> {
  const snapshots = await Promise.all([
    db.collection("noticias").where("tipo", "==", "manual").get(),
    db.collection("noticias").where("origem", "==", "senior").get(),
  ]);
  const legacyDocuments = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((document) => legacyDocuments.set(document.id, document));
  });
  const documents: GeneratedDocument[] = [];

  legacyDocuments.forEach((snapshot) => {
    const data = snapshot.data() || {};
    const isManual = data.tipo === "manual" || data.origem === "senior";
    const status = normalizeText(data.status || "publicado");
    if (!isManual || ["arquivado", "excluido", "excluida"].includes(status)) return;

    const title = firstNonEmpty(data.titulo, "Comunicado NVU");
    const message = firstNonEmpty(data.mensagem, data.conteudo, data.resumo);
    if (!message) return;
    const simulatorId = firstNonEmpty(data.simuladorId);
    const simulatorName = firstNonEmpty(data.simulador, data.simuladorNome);
    const simulatorKey = simulatorId || simulatorName
      ? normalizeSimulatorKey(simulatorName || simulatorId)
      : "all";
    const sortDate = parseDate(data.sortAt || data.dataCriacao || data.createdAt) || new Date();
    const id = `legacy_${snapshot.id}`;

    const stableData: Record<string, unknown> = {
      schemaVersion: AUTOMATION_VERSION,
      secao: "comunicados",
      tipo: "comunicado",
      categoria: "comunicado",
      titulo: title,
      mensagem: message,
      imagemUrl: firstNonEmpty(data.imagemUrl, data.imageUrl),
      simuladorId: simulatorId,
      simulador: simulatorName,
      simuladorKey: simulatorKey,
      origem: "migrado",
      status: "publicado",
      visibilidade: "publico",
      autorId: firstNonEmpty(data.autorId),
      autorNome: firstNonEmpty(data.autorNome, data.empresaNome, "Painel Sênior NVU"),
      searchTokens: buildSearchTokens(title, message, simulatorName, "comunicado"),
    };
    const contentHash = contentDigest(stableData);
    documents.push({
      id,
      contentHash,
      data: {
        ...stableData,
        contentHash,
        sortAt: admin.firestore.Timestamp.fromDate(sortDate),
        dataReferencia: admin.firestore.Timestamp.fromDate(sortDate),
      },
    });
  });

  const result = await commitDocuments(COMMUNICATIONS_COLLECTION, documents);
  return result.created + result.updated;
}

const HISTORY_STAGE_ORDER: Record<HistoryStage, number> = {
  pending: 0,
  classifications_written: 1,
  company_approvals_written: 2,
  legacy_classifications_removed: 3,
  communications_migrated: 4,
  completed: 5,
};

function normalizeHistoryStage(value: unknown): HistoryStage {
  const normalized = firstNonEmpty(value) as HistoryStage;
  return Object.prototype.hasOwnProperty.call(HISTORY_STAGE_ORDER, normalized)
    ? normalized
    : "pending";
}

function historyStageAtLeast(current: HistoryStage, expected: HistoryStage): boolean {
  return HISTORY_STAGE_ORDER[current] >= HISTORY_STAGE_ORDER[expected];
}

function storedCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

type HistoryLockDecision = "run" | "completed" | "in_progress";

async function acquireHistoryLock(runId: string): Promise<HistoryLockDecision> {
  const ref = db.collection("system_settings").doc(CONTROL_DOCUMENT_ID);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() || {};
    if (data.historyVersion === HISTORY_VERSION && data.historyStatus === "completed") return "completed";

    const lockAt = parseDate(data.historyLockAt);
    if (
      data.historyStatus === "in_progress" &&
      lockAt &&
      Date.now() - lockAt.getTime() < LOCK_TIMEOUT_MS
    ) {
      return "in_progress";
    }

    const failedAt = parseDate(data.historyFailedAt);
    if (
      data.historyVersion === HISTORY_VERSION &&
      data.historyStatus === "failed" &&
      failedAt &&
      Date.now() - failedAt.getTime() < FAILED_RETRY_COOLDOWN_MS
    ) {
      return "in_progress";
    }

    const sameCheckpoint =
      data.historyVersion === HISTORY_VERSION &&
      data.historyCheckpointVersion === HISTORY_CHECKPOINT_VERSION;
    const checkpointStage = sameCheckpoint
      ? normalizeHistoryStage(data.historyStage)
      : "pending";
    const update: FirebaseFirestore.DocumentData = {
      version: AUTOMATION_VERSION,
      historyVersion: HISTORY_VERSION,
      historyCheckpointVersion: HISTORY_CHECKPOINT_VERSION,
      historyStage: checkpointStage,
      historyStatus: "in_progress",
      historyRunId: runId,
      historyLockAt: admin.firestore.FieldValue.serverTimestamp(),
      historyLastCheckpointAt: admin.firestore.FieldValue.serverTimestamp(),
      historyLookbackDays: HISTORY_LOOKBACK_DAYS,
      historyError: admin.firestore.FieldValue.delete(),
      automationStartedAt: data.automationStartedAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!sameCheckpoint) {
      update.historyRangeStart = admin.firestore.FieldValue.delete();
      update.historyRangeEnd = admin.firestore.FieldValue.delete();
      update.sourceTripCount = admin.firestore.FieldValue.delete();
      update.generatedHistoryCount = admin.firestore.FieldValue.delete();
      update.createdCount = admin.firestore.FieldValue.delete();
      update.updatedCount = admin.firestore.FieldValue.delete();
      update.ignoredCount = admin.firestore.FieldValue.delete();
      update.companyApprovalCreatedCount = admin.firestore.FieldValue.delete();
      update.companyApprovalUpdatedCount = admin.firestore.FieldValue.delete();
      update.companyApprovalIgnoredCount = admin.firestore.FieldValue.delete();
      update.migratedCommunications = admin.firestore.FieldValue.delete();
      update.removedLegacyClassifications = admin.firestore.FieldValue.delete();
    }

    transaction.set(ref, update, { merge: true });
    return "run";
  });
}

async function saveHistoryCheckpoint(
  controlRef: FirebaseFirestore.DocumentReference,
  runId: string,
  stage: HistoryStage,
  data: FirebaseFirestore.DocumentData = {},
): Promise<void> {
  await controlRef.set({
    version: AUTOMATION_VERSION,
    historyVersion: HISTORY_VERSION,
    historyCheckpointVersion: HISTORY_CHECKPOINT_VERSION,
    historyStatus: stage === "completed" ? "completed" : "in_progress",
    historyStage: stage,
    historyRunId: runId,
    historyLockAt: admin.firestore.FieldValue.serverTimestamp(),
    historyLastCheckpointAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...data,
  }, { merge: true });
}

async function generateFullHistory(): Promise<GenerationResult> {
  const generationKey = `${HISTORY_VERSION}_${dateKey(new Date())}`;
  const runId = createHash("sha256")
    .update(`${generationKey}_${Date.now()}_${Math.random()}`)
    .digest("hex")
    .slice(0, 32);
  const lock = await acquireHistoryLock(runId);

  if (lock === "completed") {
    return {
      success: true,
      status: "already_completed",
      created: 0,
      updated: 0,
      ignored: 0,
      migratedCommunications: 0,
      sourceTrips: 0,
      generationKey,
      historyVersion: HISTORY_VERSION,
      removedLegacyClassifications: 0,
    };
  }
  if (lock === "in_progress") {
    return {
      success: true,
      status: "in_progress",
      created: 0,
      updated: 0,
      ignored: 0,
      migratedCommunications: 0,
      sourceTrips: 0,
      generationKey,
      historyVersion: HISTORY_VERSION,
      removedLegacyClassifications: 0,
    };
  }

  const controlRef = db.collection("system_settings").doc(CONTROL_DOCUMENT_ID);
  let stage: HistoryStage = "pending";
  try {
    const controlSnapshot = await controlRef.get();
    const control = controlSnapshot.data() || {};
    const sameCheckpoint =
      control.historyVersion === HISTORY_VERSION &&
      control.historyCheckpointVersion === HISTORY_CHECKPOINT_VERSION;
    stage = sameCheckpoint ? normalizeHistoryStage(control.historyStage) : "pending";

    const storedRangeEnd = sameCheckpoint ? parseDate(control.historyRangeEnd) : null;
    const storedRangeStart = sameCheckpoint ? parseDate(control.historyRangeStart) : null;
    const rangeEnd = storedRangeEnd || new Date();
    const rangeStart = storedRangeStart || subtractDays(rangeEnd, HISTORY_LOOKBACK_DAYS);

    let sourceTrips = storedCount(control.sourceTripCount);
    let generatedHistoryCount = storedCount(control.generatedHistoryCount);
    let created = storedCount(control.createdCount);
    let updated = storedCount(control.updatedCount);
    let ignored = storedCount(control.ignoredCount);
    let companyApprovalCreated = storedCount(control.companyApprovalCreatedCount);
    let companyApprovalUpdated = storedCount(control.companyApprovalUpdatedCount);
    let companyApprovalIgnored = storedCount(control.companyApprovalIgnoredCount);
    let removedLegacyClassifications = storedCount(control.removedLegacyClassifications);
    let migratedCommunications = storedCount(control.migratedCommunications);

    if (stage === "pending") {
      await saveHistoryCheckpoint(controlRef, runId, "pending", {
        historyRangeStart: admin.firestore.Timestamp.fromDate(rangeStart),
        historyRangeEnd: admin.firestore.Timestamp.fromDate(rangeEnd),
        historyLookbackDays: HISTORY_LOOKBACK_DAYS,
      });
    }

    if (!historyStageAtLeast(stage, "classifications_written")) {
      const periods = closedPeriodsInRange(
        rangeStart,
        rangeEnd,
        ["semana", "mes"],
      );
      const reconciliation = await reconcileClosedPeriods(periods, "historico");
      sourceTrips = reconciliation.sourceTrips;
      generatedHistoryCount = reconciliation.generated;
      created = reconciliation.created;
      updated = reconciliation.updated;
      ignored = reconciliation.ignored;
      removedLegacyClassifications += reconciliation.removed;
      stage = "classifications_written";
      await saveHistoryCheckpoint(controlRef, runId, stage, {
        historyRangeStart: admin.firestore.Timestamp.fromDate(rangeStart),
        historyRangeEnd: admin.firestore.Timestamp.fromDate(rangeEnd),
        sourceTripCount: sourceTrips,
        generatedHistoryCount,
        createdCount: created,
        updatedCount: updated,
        ignoredCount: ignored,
        removedLegacyClassifications,
      });
    }

    if (!historyStageAtLeast(stage, "company_approvals_written")) {
      const approvalWriteResult = await syncCompanyApprovalNewsHistory();
      companyApprovalCreated = approvalWriteResult.created;
      companyApprovalUpdated = approvalWriteResult.updated;
      companyApprovalIgnored = approvalWriteResult.ignored;
      created += companyApprovalCreated;
      updated += companyApprovalUpdated;
      ignored += companyApprovalIgnored;
      stage = "company_approvals_written";
      await saveHistoryCheckpoint(controlRef, runId, stage, {
        createdCount: created,
        updatedCount: updated,
        ignoredCount: ignored,
        companyApprovalCreatedCount: companyApprovalCreated,
        companyApprovalUpdatedCount: companyApprovalUpdated,
        companyApprovalIgnoredCount: companyApprovalIgnored,
      });
    }

    if (!historyStageAtLeast(stage, "legacy_classifications_removed")) {
      removedLegacyClassifications += await deleteLegacyCombinedClassifications(
        rangeStart,
      );
      stage = "legacy_classifications_removed";
      await saveHistoryCheckpoint(controlRef, runId, stage, {
        removedLegacyClassifications,
      });
    }

    if (!historyStageAtLeast(stage, "communications_migrated")) {
      migratedCommunications = await migrateLegacyCommunications();
      stage = "communications_migrated";
      await saveHistoryCheckpoint(controlRef, runId, stage, {
        migratedCommunications,
      });
    }

    stage = "completed";
    await saveHistoryCheckpoint(controlRef, runId, stage, {
      historyRangeStart: admin.firestore.Timestamp.fromDate(rangeStart),
      historyRangeEnd: admin.firestore.Timestamp.fromDate(rangeEnd),
      historyLookbackDays: HISTORY_LOOKBACK_DAYS,
      sourceTripCount: sourceTrips,
      generatedHistoryCount,
      createdCount: created,
      updatedCount: updated,
      ignoredCount: ignored,
      companyApprovalCreatedCount: companyApprovalCreated,
      companyApprovalUpdatedCount: companyApprovalUpdated,
      companyApprovalIgnoredCount: companyApprovalIgnored,
      migratedCommunications,
      removedLegacyClassifications,
      historyCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      publicationPolicy: {
        timeZone: NEWS_TIME_ZONE,
        periodPolicy: RANKING_PERIOD_POLICY,
        weekly: "domingo às 00:00 UTC, após o encerramento de sábado",
        monthly: "primeiro instante do primeiro dia do mês em UTC",
        history: "migração única limitada aos últimos 70 dias, retomada por checkpoints persistentes",
        pagination: "o aplicativo lê somente 10 publicações por vez",
        captions: "cinco modelos fixos alternados sem uso de inteligência artificial",
        posts: "empresa e motorista publicados em notícias independentes; participante único recebe somente o post Fim da temporada",
        companies: "empresas removidas não participam do histórico nem das próximas classificações",
        approvals: "cada empresa aprovada recebe um post automático ordenado pela data de aprovação registrada no Painel Sênior",
      },
    });

    return {
      success: true,
      status: "completed",
      created,
      updated,
      ignored,
      migratedCommunications,
      sourceTrips,
      generationKey,
      historyVersion: HISTORY_VERSION,
      removedLegacyClassifications,
    };
  } catch (error) {
    await controlRef.set({
      historyCheckpointVersion: HISTORY_CHECKPOINT_VERSION,
      historyStatus: "failed",
      historyStage: stage,
      historyRunId: runId,
      historyError: error instanceof Error ? error.message : String(error),
      historyFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      historyLastCheckpointAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error("[NVU NEWS] Falha ao gerar histórico compacto:", error);
    throw error;
  }
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 86_400_000);
}

async function generateRecent(periodTypes: PeriodType[], sourceLabel: string): Promise<void> {
  const now = new Date();
  const rangeStart = subtractDays(now, periodTypes.includes("mes") ? 70 : 16);
  const controlSnapshot = await db.collection("system_settings").doc(CONTROL_DOCUMENT_ID).get();
  const automationStartedAt = parseDate(controlSnapshot.data()?.automationStartedAt) || new Date(0);
  const periods = closedPeriodsInRange(rangeStart, now, periodTypes, now).filter(
    (period) => period.publicationAt.getTime() > automationStartedAt.getTime(),
  );
  const reconciliation = await reconcileClosedPeriods(periods, "automatico");

  await db.collection("system_settings").doc(CONTROL_DOCUMENT_ID).set({
    version: AUTOMATION_VERSION,
    lastAutomaticSource: sourceLabel,
    lastAutomaticRunAt: admin.firestore.FieldValue.serverTimestamp(),
    lastAutomaticSourceTrips: reconciliation.sourceTrips,
    lastAutomaticGenerated: reconciliation.generated,
    lastAutomaticCreated: reconciliation.created,
    lastAutomaticUpdated: reconciliation.updated,
    lastAutomaticIgnored: reconciliation.ignored,
    lastAutomaticRemoved: reconciliation.removed,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

export const updateNvuNewsClassificationsOnRankingAggregateWrite = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .firestore.document("ranking_aggregates/{aggregateId}")
  .onWrite(async (change) => {
    if (!change.after.exists) return;
    const before = change.before.exists ? change.before.data() : undefined;
    const after = change.after.data();
    if (!after) return;
    const beforeRevision = Number(before?.revision || 0);
    const afterRevision = Number(after.revision || 0);
    if (
      before &&
      beforeRevision === afterRevision &&
      Number(before.schemaVersion) === Number(after.schemaVersion) &&
      before.complete === after.complete
    ) {
      return;
    }
    await reconcileFromRankingAggregate(after);
  });

export const updateNvuNewsClassificationsOnClosedTripWrite = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .firestore.document("historico_viagens/{tripId}")
  .onWrite(async (change) => {
    const periods = uniquePeriods([
      ...closedPeriodsForTripData(
        change.before.exists ? change.before.data() : undefined,
      ),
      ...closedPeriodsForTripData(
        change.after.exists ? change.after.data() : undefined,
      ),
    ]);
    if (periods.length === 0) return;
    await reconcileClosedPeriods(periods, "automatico");
  });

export const updateNvuNewsClassificationsOnCompanyWrite = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .firestore.document("frotas/{companyId}")
  .onWrite(async (change) => {
    const before = change.before.exists ? change.before.data() : undefined;
    const after = change.after.exists ? change.after.data() : undefined;
    if (companyClassificationSignature(before) === companyClassificationSignature(after)) {
      return;
    }
    const now = new Date();
    const periods = closedPeriodsInRange(
      subtractDays(now, HISTORY_LOOKBACK_DAYS),
      now,
      ["semana", "mes"],
      now,
    );
    await reconcileClosedPeriods(periods, "automatico");
  });

export const updateNvuNewsClassificationsOnSimulatorWrite = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .firestore.document("simulators/{simulatorId}")
  .onWrite(async () => {
    simulatorCatalogCache = null;
    const now = new Date();
    const periods = closedPeriodsInRange(
      subtractDays(now, HISTORY_LOOKBACK_DAYS),
      now,
      ["semana", "mes"],
      now,
    );
    await reconcileClosedPeriods(periods, "automatico");
  });

export const generateNvuNewsBackfill = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onCall(async (_data, context) => {
    await requireActiveSenior(context);

    try {
      return await generateFullHistory();
    } catch (error) {
      throw new functions.https.HttpsError("internal", "Não foi possível preparar o histórico de classificações.");
    }
  });

export const generateNvuNewsScheduled = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("35 0 * * 0")
  .timeZone(NEWS_TIME_ZONE)
  .onRun(async () => {
    await generateRecent(["semana"], "weekly_scheduler");
    return null;
  });

export const generateNvuNewsMonthlyScheduled = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("40 0 1 * *")
  .timeZone(NEWS_TIME_ZONE)
  .onRun(async () => {
    await generateRecent(["mes"], "monthly_scheduler");
    return null;
  });
