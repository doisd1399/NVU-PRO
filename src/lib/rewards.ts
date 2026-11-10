/** Recompensas (cliente): tipos, leitura defensiva dos documentos e contas do simulador (iguais às do servidor). */
export type RewardCampaignStatus = "active" | "cancelled";
export type RewardCampaign = {
  id: string; companyId: string; name: string; startMs: number; endMs: number; perTripCents: number; bonusCents: number; bonusGoalTrips: number; budgetCents: number;
  audience: "all" | "selected"; status: RewardCampaignStatus; accruedCents: number; tripsCount: number; capped: boolean; driversCount: number; acceptedCount: number; createdAtMs: number;
};
export type RewardOfferStatus = "pending" | "accepted" | "declined" | "cancelled";
export type RewardOffer = {
  id: string; campaignId: string; companyId: string; companyName: string; driverId: string; driverName: string; status: RewardOfferStatus; name: string;
  startMs: number; endMs: number; perTripCents: number; bonusCents: number; bonusGoalTrips: number;
  trips: number; tripCents: number; bonusEarnedCents: number; totalCents: number; settledCents: number; goalReached: boolean; acceptedAtMs: number; createdAtMs: number;
};
const ms = (value: any): number => (value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value === "number" ? value : Date.parse(String(value || "")))) || 0;
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function normalizeCampaign(id: string, raw: Record<string, any>): RewardCampaign {
  return { id, companyId: text(raw.companyId), name: text(raw.name) || "Campanha", startMs: num(raw.startMs), endMs: num(raw.endMs), perTripCents: num(raw.perTripCents), bonusCents: num(raw.bonusCents),
    bonusGoalTrips: num(raw.bonusGoalTrips), budgetCents: num(raw.budgetCents), audience: raw.audience === "selected" ? "selected" : "all", status: raw.status === "cancelled" ? "cancelled" : "active",
    accruedCents: num(raw.accruedCents), tripsCount: num(raw.tripsCount), capped: raw.capped === true, driversCount: num(raw.driversCount), acceptedCount: num(raw.acceptedCount), createdAtMs: ms(raw.createdAt) };
}
export function normalizeOffer(id: string, raw: Record<string, any>): RewardOffer {
  const status = (["pending", "accepted", "declined", "cancelled"] as const).find(item => item === raw.status) || "pending";
  return { id, campaignId: text(raw.campaignId), companyId: text(raw.companyId), companyName: text(raw.companyName) || "Empresa", driverId: text(raw.driverId), driverName: text(raw.driverName) || "Motorista", status, name: text(raw.name) || "Campanha",
    startMs: num(raw.startMs), endMs: num(raw.endMs), perTripCents: num(raw.perTripCents), bonusCents: num(raw.bonusCents), bonusGoalTrips: num(raw.bonusGoalTrips),
    trips: num(raw.trips), tripCents: num(raw.tripCents), bonusEarnedCents: num(raw.bonusEarnedCents), totalCents: num(raw.totalCents), settledCents: num(raw.settledCents), goalReached: raw.goalReached === true, acceptedAtMs: num(raw.acceptedAtMs), createdAtMs: ms(raw.createdAt) };
}

export type CampaignState = "active" | "scheduled" | "ended" | "cancelled" | "capped";
export function campaignState(c: Pick<RewardCampaign, "status" | "startMs" | "endMs" | "capped">, now: number): CampaignState {
  if (c.status === "cancelled") return "cancelled"; if (c.capped) return "capped"; if (now > c.endMs) return "ended"; if (now < c.startMs) return "scheduled"; return "active";
}
export const CAMPAIGN_STATE_LABEL: Record<CampaignState, string> = { active: "Ativa", scheduled: "Agendada", ended: "Encerrada", cancelled: "Cancelada", capped: "Teto atingido" };
export const OFFER_STATE_LABEL: Record<RewardOfferStatus, string> = { pending: "Aguardando", accepted: "Aceitou", declined: "Recusou", cancelled: "Cancelada" };

/** Custo máximo estimado (igual ao do servidor): cada motorista faz `tripsPerDriver` viagens e, se houver bônus, bate a meta. */
export function estimateMaxCost(terms: { perTripCents: number; bonusCents: number; bonusGoalTrips: number }, drivers: number, tripsPerDriver: number) {
  const trips = Math.max(0, Math.floor(tripsPerDriver)), tripsCents = drivers * trips * terms.perTripCents;
  const bonusTotal = terms.bonusCents > 0 && trips >= terms.bonusGoalTrips ? drivers * terms.bonusCents : 0;
  return { tripsCents, bonusCents: bonusTotal, totalCents: tripsCents + bonusTotal };
}
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayMonth = (ms: number) => { const [, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)).split("-"); return { day, month: MONTHS[Number(month) - 1] }; };
/** "10 a 16 nov" (mesmo mês) ou "28 out a 03 nov"; igual em qualquer aparelho (sem depender do ICU). */
export const periodText = (startMs: number, endMs: number) => {
  const a = dayMonth(startMs), b = dayMonth(endMs);
  return a.day === b.day && a.month === b.month ? `${a.day} ${a.month}` : a.month === b.month ? `${a.day} a ${b.day} ${b.month}` : `${a.day} ${a.month} a ${b.day} ${b.month}`;
};
export const rewardErrorMessage = (error: unknown, fallback: string) => String((error as { message?: string })?.message || "").replace(/^(functions|firebase)[^:]*:\s*/i, "").trim() || fallback;
