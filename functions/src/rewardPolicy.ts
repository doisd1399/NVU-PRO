/**
 * Recompensas: campanhas de uma empresa para os motoristas dela (ganho por viagem, bônus de meta, teto de investimento).
 * Regras puras (servidor e testes). O NVU só calcula e registra: ninguém paga por aqui.
 */
import { fail, text } from "./operationalCommandPolicy";

export const REWARD_CAMPAIGNS = "rewardCampaigns";
export const REWARD_OFFERS = "rewardOffers";
export const MAX_REWARD_DRIVERS = 100;
export const MAX_CAMPAIGN_DAYS = 92;
export type RewardAudience = "all" | "selected";
export type RewardTerms = { startMs: number; endMs: number; perTripCents: number; bonusCents: number; bonusGoalTrips: number; budgetCents: number; contractId?: string; maxTripsPerDriver?: number };
export type RewardCampaignInput = RewardTerms & { name: string; audience: RewardAudience; driverIds: string[]; contractId: string; maxTripsPerDriver: number };

const DAY = 86_400_000, BRT = "-03:00";
const dateKey = (value: unknown): string => { const raw = text(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00${BRT}`))) fail("invalid-argument", "Informe as datas da campanha."); return raw; };
const cents = (value: unknown, label: string, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail("invalid-argument", `${label} inválido.`);
  return n;
};
/** Início 00:00 e fim 23:59:59.999 (horário de Brasília) dos dias informados. */
export const dayBounds = (start: string, end: string) => ({ startMs: Date.parse(`${start}T00:00:00.000${BRT}`), endMs: Date.parse(`${end}T23:59:59.999${BRT}`) });

export function normalizeCampaign(raw: Record<string, any>, now: number): RewardCampaignInput {
  const name = text(raw.name).replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 60) fail("invalid-argument", "O nome da campanha precisa ter de 3 a 60 caracteres.");
  const startDate = dateKey(raw.startDate), endDate = dateKey(raw.endDate), { startMs, endMs } = dayBounds(startDate, endDate);
  if (endMs < startMs) fail("invalid-argument", "O fim da campanha não pode ser antes do início.");
  if (endMs < now) fail("invalid-argument", "O período da campanha já terminou.");
  if ((endMs - startMs) / DAY > MAX_CAMPAIGN_DAYS) fail("invalid-argument", `A campanha pode durar no máximo ${MAX_CAMPAIGN_DAYS} dias.`);
  const perTripCents = cents(raw.perTripCents, "O valor por viagem", 1, 1_000_000);
  const bonusCents = cents(raw.bonusCents ?? 0, "O bônus", 0, 10_000_000);
  const bonusGoalTrips = cents(raw.bonusGoalTrips ?? 0, "A meta do bônus", 0, 1000);
  if (bonusCents > 0 && bonusGoalTrips < 1) fail("invalid-argument", "Informe a meta de viagens para o bônus.");
  // Teto informado é opcional: sem ele o servidor calcula (motoristas × viagens × valor), ver `campaignBudget`.
  const budgetCents = raw.budgetCents === undefined || raw.budgetCents === null ? 0 : cents(raw.budgetCents, "O teto de investimento", perTripCents, 100_000_000);
  const contractId = text(raw.contractId);
  const maxTripsPerDriver = raw.maxTripsPerDriver === undefined || raw.maxTripsPerDriver === null ? 0 : cents(raw.maxTripsPerDriver, "A quantidade de viagens por motorista", 1, 1000);
  const audience: RewardAudience = raw.audience === "selected" ? "selected" : "all";
  const driverIds = [...new Set((Array.isArray(raw.driverIds) ? raw.driverIds : []).map(text).filter(Boolean))];
  if (audience === "selected" && !driverIds.length) fail("invalid-argument", "Escolha ao menos um motorista.");
  if (driverIds.length > MAX_REWARD_DRIVERS) fail("invalid-argument", `Escolha no máximo ${MAX_REWARD_DRIVERS} motoristas.`);
  return { name, startMs, endMs, perTripCents, bonusCents: bonusGoalTrips ? bonusCents : 0, bonusGoalTrips: bonusCents ? bonusGoalTrips : 0, budgetCents, audience, driverIds, contractId, maxTripsPerDriver };
}

/** Teto da campanha: cada motorista pode receber até `maxTripsPerDriver` viagens (e o bônus, se houver). Igual no app. */
export function campaignBudget(terms: Pick<RewardTerms, "perTripCents" | "bonusCents"> & { maxTripsPerDriver: number }, drivers: number): number {
  return drivers * (terms.maxTripsPerDriver * terms.perTripCents + terms.bonusCents);
}

/** Custo máximo estimado: cada motorista faz `tripsPerDriver` viagens e (se houver bônus) bate a meta. Igual no app (simulador). */
export function estimateMaxCost(terms: Pick<RewardTerms, "perTripCents" | "bonusCents" | "bonusGoalTrips">, drivers: number, tripsPerDriver: number) {
  const trips = Math.max(0, Math.floor(tripsPerDriver)), tripsCents = drivers * trips * terms.perTripCents;
  const bonusDrivers = terms.bonusCents > 0 && trips >= terms.bonusGoalTrips ? drivers : 0, bonusTotal = bonusDrivers * terms.bonusCents;
  return { tripsCents, bonusCents: bonusTotal, totalCents: tripsCents + bonusTotal };
}

export type AccrualTrip = { id: string; driverId: string; at: number; contractId?: string };
export type AccrualOffer = { driverId: string; acceptedAtMs: number };
export type DriverAccrual = { trips: number; tripCents: number; bonusCents: number; totalCents: number; goalReached: boolean };
/**
 * Ganho por viagem confirmada dentro do período e depois do aceite de cada motorista (cada viagem conta uma vez, em ordem de conclusão).
 * O bônus entra quando o motorista completa a meta. Ao chegar no teto a campanha para: nada além do teto é creditado.
 */
export function accrueRewards(terms: RewardTerms, offers: AccrualOffer[], trips: AccrualTrip[]) {
  const accepted = new Map(offers.map(offer => [offer.driverId, offer.acceptedAtMs]));
  const seen = new Set<string>();
  const eligible = trips.filter(trip => {
    if (seen.has(trip.id)) return false; seen.add(trip.id);
    if (terms.contractId && trip.contractId !== terms.contractId) return false; // só viagens da operação da campanha
    const from = accepted.get(trip.driverId);
    return from !== undefined && trip.at > 0 && trip.at >= Math.max(terms.startMs, from) && trip.at <= terms.endMs;
  }).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const drivers = new Map<string, DriverAccrual>(offers.map(offer => [offer.driverId, { trips: 0, tripCents: 0, bonusCents: 0, totalCents: 0, goalReached: false }]));
  let accruedCents = 0, tripsCount = 0, capped = false;
  for (const trip of eligible) {
    if (accruedCents + terms.perTripCents > terms.budgetCents) { capped = true; break; }
    const row = drivers.get(trip.driverId)!;
    if (terms.maxTripsPerDriver && row.trips >= terms.maxTripsPerDriver) continue; // limite de viagens pagas por motorista
    row.trips++; row.tripCents += terms.perTripCents; accruedCents += terms.perTripCents; tripsCount++;
    if (terms.bonusCents > 0 && terms.bonusGoalTrips > 0 && row.trips === terms.bonusGoalTrips) {
      if (accruedCents + terms.bonusCents > terms.budgetCents) { capped = true; row.totalCents = row.tripCents; break; }
      row.bonusCents = terms.bonusCents; accruedCents += terms.bonusCents; row.goalReached = true;
    }
    row.totalCents = row.tripCents + row.bonusCents;
  }
  drivers.forEach(row => { row.totalCents = row.tripCents + row.bonusCents; });
  return { drivers, accruedCents, tripsCount, capped };
}

// ───────────── Fase 2: folha de pagamento, comprovante e confirmação ─────────────
export const REWARD_SETTINGS = "rewardSettings";
export const REWARD_PAYEES = "rewardPayees";
export const REWARD_PAYMENTS = "rewardPayments";
export const MAX_PAYROLL_DRIVERS = 200;
export type PaymentStatus = "pending" | "paid" | "received" | "contested" | "cancelled";
export type PaymentAction = "pay" | "receive" | "contest" | "cancel";
export type PayrollOffer = { id: string; campaignId: string; campaignName: string; driverId: string; totalCents: number; settledCents: number };
export type PayrollLine = { driverId: string; amountCents: number; items: { offerId: string; campaignId: string; campaignName: string; cents: number }[] };

/** Dia da semana (0 = domingo) em horário de Brasília. */
export const weekdayBRT = (ms: number): number => new Date(ms - 3 * 3_600_000).getUTCDay();
/** Data (AAAA-MM-DD) em horário de Brasília. */
export const dateBRT = (ms: number): string => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
export const normalizePayDay = (value: unknown): number => {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 0 || day > 6) fail("invalid-argument", "Escolha o dia da semana do pagamento.");
  return day;
};

/**
 * O que cada motorista ainda tem a receber: ganho calculado (campanhas aceitas) menos o que já entrou em uma folha.
 * Valores negativos (viagem removida depois) contam como zero. Só entra quem tem saldo; ordem estável por nome do motorista (id).
 */
export function buildPayroll(offers: PayrollOffer[]): PayrollLine[] {
  const byDriver = new Map<string, PayrollLine>();
  for (const offer of [...offers].sort((a, b) => a.driverId.localeCompare(b.driverId) || a.id.localeCompare(b.id))) {
    const cents = Math.max(0, Math.floor(offer.totalCents) - Math.max(0, Math.floor(offer.settledCents)));
    if (cents <= 0) continue;
    const line = byDriver.get(offer.driverId) || { driverId: offer.driverId, amountCents: 0, items: [] };
    line.amountCents += cents; line.items.push({ offerId: offer.id, campaignId: offer.campaignId, campaignName: offer.campaignName, cents });
    byDriver.set(offer.driverId, line);
  }
  return [...byDriver.values()];
}

const TRANSITIONS: Record<PaymentAction, { from: PaymentStatus[]; to: PaymentStatus }> = {
  pay: { from: ["pending", "contested"], to: "paid" },
  receive: { from: ["paid"], to: "received" },
  contest: { from: ["paid"], to: "contested" },
  cancel: { from: ["pending", "contested"], to: "cancelled" },
};
/** Estado seguinte de um pagamento; `null` quando a ação não vale no estado atual. Recebido e cancelado são finais. */
export const nextPaymentStatus = (current: PaymentStatus, action: PaymentAction): PaymentStatus | null => TRANSITIONS[action].from.includes(current) ? TRANSITIONS[action].to : null;

/** Número do comprovante, estável para o mesmo pagamento e a mesma data de pagamento (ex.: RC-20261110-3FA9C2D1). */
export const receiptNumber = (paymentId: string, paidAtMs: number): string => {
  let hash = 0x811c9dc5;
  for (const char of `${paymentId}|${paidAtMs}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `RC-${dateBRT(paidAtMs).replace(/-/g, "")}-${hash.toString(16).toUpperCase().padStart(8, "0")}`;
};
/** Chave Pix parcialmente escondida para o comprovante (o comprovante circula entre as duas partes). */
export const maskPixKey = (type: string, key: string): string => {
  if (!key) return "";
  if (type === "cpf") return `***.${key.slice(3, 6)}.${key.slice(6, 9)}-**`;
  if (type === "cnpj") return `**.${key.slice(2, 5)}.${key.slice(5, 8)}/****-**`;
  if (type === "phone") return `${key.slice(0, 5)}*****${key.slice(-2)}`;
  if (type === "email") { const [name = "", host = ""] = key.split("@"); return `${name.slice(0, 2)}***@${host}`; }
  return `${key.slice(0, 8)}-****-****-****-${key.slice(-4)}`;
};
/** Identificador da transação Pix (E2E) informado pela empresa; opcional. */
export const normalizeE2e = (value: unknown): string => {
  const raw = text(value).replace(/\s+/g, "");
  if (!raw) return "";
  if (!/^[A-Za-z0-9]{10,40}$/.test(raw)) fail("invalid-argument", "O código da transação Pix deve ter de 10 a 40 letras e números.");
  return raw;
};
export const normalizeDispute = (value: unknown): string => {
  const reason = text(value).replace(/\s+/g, " ");
  if (reason.length < 5 || reason.length > 300) fail("invalid-argument", "Explique o motivo em 5 a 300 caracteres.");
  return reason;
};
