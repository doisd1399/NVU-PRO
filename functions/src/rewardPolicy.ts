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
export type RewardTerms = { startMs: number; endMs: number; perTripCents: number; bonusCents: number; bonusGoalTrips: number; budgetCents: number };
export type RewardCampaignInput = RewardTerms & { name: string; audience: RewardAudience; driverIds: string[] };

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
  const budgetCents = cents(raw.budgetCents, "O teto de investimento", perTripCents, 100_000_000);
  const audience: RewardAudience = raw.audience === "selected" ? "selected" : "all";
  const driverIds = [...new Set((Array.isArray(raw.driverIds) ? raw.driverIds : []).map(text).filter(Boolean))];
  if (audience === "selected" && !driverIds.length) fail("invalid-argument", "Escolha ao menos um motorista.");
  if (driverIds.length > MAX_REWARD_DRIVERS) fail("invalid-argument", `Escolha no máximo ${MAX_REWARD_DRIVERS} motoristas.`);
  return { name, startMs, endMs, perTripCents, bonusCents: bonusGoalTrips ? bonusCents : 0, bonusGoalTrips: bonusCents ? bonusGoalTrips : 0, budgetCents, audience, driverIds };
}

/** Custo máximo estimado: cada motorista faz `tripsPerDriver` viagens e (se houver bônus) bate a meta. Igual no app (simulador). */
export function estimateMaxCost(terms: Pick<RewardTerms, "perTripCents" | "bonusCents" | "bonusGoalTrips">, drivers: number, tripsPerDriver: number) {
  const trips = Math.max(0, Math.floor(tripsPerDriver)), tripsCents = drivers * trips * terms.perTripCents;
  const bonusDrivers = terms.bonusCents > 0 && trips >= terms.bonusGoalTrips ? drivers : 0, bonusTotal = bonusDrivers * terms.bonusCents;
  return { tripsCents, bonusCents: bonusTotal, totalCents: tripsCents + bonusTotal };
}

export type AccrualTrip = { id: string; driverId: string; at: number };
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
    const from = accepted.get(trip.driverId);
    return from !== undefined && trip.at > 0 && trip.at >= Math.max(terms.startMs, from) && trip.at <= terms.endMs;
  }).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const drivers = new Map<string, DriverAccrual>(offers.map(offer => [offer.driverId, { trips: 0, tripCents: 0, bonusCents: 0, totalCents: 0, goalReached: false }]));
  let accruedCents = 0, tripsCount = 0, capped = false;
  for (const trip of eligible) {
    if (accruedCents + terms.perTripCents > terms.budgetCents) { capped = true; break; }
    const row = drivers.get(trip.driverId)!;
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
