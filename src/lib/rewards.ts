/** Recompensas (cliente): tipos, leitura defensiva dos documentos e contas do simulador (iguais às do servidor). */
export type RewardCampaignStatus = "active" | "cancelled";
export type RewardCampaign = {
  id: string; companyId: string; name: string; startMs: number; endMs: number; perTripCents: number; bonusCents: number; bonusGoalTrips: number; budgetCents: number;
  audience: "all" | "selected"; contractId: string; contractName: string; maxTripsPerDriver: number; goalCents: number; openEnded: boolean; deadlineDays: number; status: RewardCampaignStatus; accruedCents: number; tripsCount: number; capped: boolean; driversCount: number; acceptedCount: number; createdAtMs: number; vehicleId: string; vehicleName: string; revision: number; hidden: boolean;
};
export type RewardOfferStatus = "pending" | "accepted" | "declined" | "cancelled";
export type RewardOffer = {
  id: string; campaignId: string; companyId: string; companyName: string; driverId: string; driverName: string; status: RewardOfferStatus; name: string;
  startMs: number; endMs: number; perTripCents: number; bonusCents: number; bonusGoalTrips: number; contractId: string; contractName: string; maxTripsPerDriver: number; goalCents: number; openEnded: boolean; deadlineDays: number; payDay: number | null; deadlineMs: number; expired: boolean; goalMissed: boolean; goalRequired: boolean; lostCents: number; expiredAtMs: number; completedAtMs: number;
  trips: number; tripCents: number; bonusEarnedCents: number; totalCents: number; settledCents: number; simCents: number; goalReached: boolean; acceptedAtMs: number; createdAtMs: number;
  jobId: string; vehicleId: string; vehicleName: string; vehiclePlate: string; revision: number; changedAtMs: number; changeNote: string;
};
const ms = (value: any): number => (value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value === "number" ? value : Date.parse(String(value || "")))) || 0;
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function normalizeCampaign(id: string, raw: Record<string, any>): RewardCampaign {
  return { id, companyId: text(raw.companyId), name: text(raw.name) || "Campanha", startMs: num(raw.startMs), endMs: num(raw.endMs), perTripCents: num(raw.perTripCents), bonusCents: num(raw.bonusCents),
    bonusGoalTrips: num(raw.bonusGoalTrips), budgetCents: num(raw.budgetCents), audience: raw.audience === "selected" ? "selected" : "all", contractId: text(raw.contractId), contractName: text(raw.contractName), maxTripsPerDriver: num(raw.maxTripsPerDriver), goalCents: num(raw.goalCents), openEnded: raw.openEnded === true, deadlineDays: num(raw.deadlineDays), status: raw.status === "cancelled" ? "cancelled" : "active",
    accruedCents: num(raw.accruedCents), tripsCount: num(raw.tripsCount), capped: raw.capped === true, driversCount: num(raw.driversCount), acceptedCount: num(raw.acceptedCount), createdAtMs: ms(raw.createdAt), vehicleId: text(raw.vehicleId), vehicleName: text(raw.vehicleName), revision: num(raw.revision) || 1, hidden: raw.hidden === true };
}
export function normalizeOffer(id: string, raw: Record<string, any>): RewardOffer {
  const status = (["pending", "accepted", "declined", "cancelled"] as const).find(item => item === raw.status) || "pending";
  return { id, campaignId: text(raw.campaignId), companyId: text(raw.companyId), companyName: text(raw.companyName) || "Empresa", driverId: text(raw.driverId), driverName: text(raw.driverName) || "Motorista", status, name: text(raw.name) || "Campanha",
    startMs: num(raw.startMs), endMs: num(raw.endMs), perTripCents: num(raw.perTripCents), bonusCents: num(raw.bonusCents), bonusGoalTrips: num(raw.bonusGoalTrips), contractId: text(raw.contractId), contractName: text(raw.contractName), maxTripsPerDriver: num(raw.maxTripsPerDriver), goalCents: num(raw.goalCents), openEnded: raw.openEnded === true, deadlineDays: num(raw.deadlineDays), payDay: Number.isInteger(raw.payDay) && raw.payDay >= 0 && raw.payDay <= 6 ? raw.payDay : null,
    deadlineMs: num(raw.deadlineMs), expired: raw.expired === true, goalMissed: raw.goalMissed === true, goalRequired: raw.goalRequired === true, lostCents: num(raw.lostCents), expiredAtMs: num(raw.expiredAtMs), completedAtMs: num(raw.completedAtMs),
    trips: num(raw.trips), tripCents: num(raw.tripCents), bonusEarnedCents: num(raw.bonusEarnedCents), totalCents: num(raw.totalCents), settledCents: num(raw.settledCents), simCents: num(raw.simCents), goalReached: raw.goalReached === true, acceptedAtMs: num(raw.acceptedAtMs), createdAtMs: ms(raw.createdAt),
    jobId: text(raw.jobId), vehicleId: text(raw.vehicleId), vehicleName: text(raw.vehicleName), vehiclePlate: text(raw.vehiclePlate), revision: num(raw.revision) || 1, changedAtMs: num(raw.changedAtMs), changeNote: text(raw.changeNote) };
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
/** Máximo de salário de um motorista (igual ao do servidor): viagens da operação × salário por viagem. */
export const driverMaxCents = (terms: { perTripCents: number; maxTripsPerDriver: number }) => terms.maxTripsPerDriver * terms.perTripCents;
/** Teto da campanha em salário (igual ao do servidor): motoristas × o máximo de cada um (+ bônus, só em campanhas antigas). */
export const campaignBudget = (terms: { perTripCents: number; bonusCents: number; maxTripsPerDriver: number }, drivers: number) => drivers * (driverMaxCents(terms) + terms.bonusCents);
/** Estimativa da meta: soma da meta de ganhos da operação de todos os motoristas selecionados. */
export const goalEstimate = (goalCents: number, drivers: number) => Math.max(0, goalCents) * Math.max(0, drivers);
/** Meta de ganhos da operação do motorista (total dos ganhos de todas as viagens da operação) (0 = campanha sem meta). Não tem relação com o salário por viagem. */
export const goalOf = (c: { goalCents: number }) => c.goalCents || 0;
/** O motorista concluiu a operação (fez todas as viagens dela): só então o salário entra na folha. Igual ao servidor; campanhas antigas contam o que foi ganho. */
export const offerCompleted = (offer: { totalCents: number; trips?: number; maxTripsPerDriver?: number; expired?: boolean; goalMissed?: boolean }) => {
  if (offer.expired || offer.goalMissed) return false; // prazo perdido ou meta de ganhos não atingida: não recebe
  const max = Number(offer.maxTripsPerDriver) || 0;
  return max > 0 ? (Number(offer.trips) || 0) >= max : (Number(offer.totalCents) || 0) > 0;
};
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayMonth = (ms: number) => { const [, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)).split("-"); return { day, month: MONTHS[Number(month) - 1] }; };
/** "10 a 16 nov" (mesmo mês) ou "28 out a 03 nov"; igual em qualquer aparelho (sem depender do ICU). */
export const periodText = (startMs: number, endMs: number) => {
  const a = dayMonth(startMs), b = dayMonth(endMs);
  return a.day === b.day && a.month === b.month ? `${a.day} ${a.month}` : a.month === b.month ? `${a.day} a ${b.day} ${b.month}` : `${a.day} ${a.month} a ${b.day} ${b.month}`;
};
export const rewardErrorMessage = (error: unknown, fallback: string) => {
  const raw = String((error as { message?: string })?.message || "").replace(/^(functions|firebase)[^:]*:\s*/i, "").trim();
  // "internal", "not-found" etc. sem texto: a função ainda não está publicada ou o servidor falhou; não mostrar o código cru.
  if (!raw || /^(internal|not-found|unavailable|unknown|deadline-exceeded)(\s*\[\d+\])?$/i.test(raw)) return `${fallback} O servidor não respondeu; tente de novo em instantes.`;
  return raw;
};
/** Prazo da campanha em texto curto ("4 dias"): sem datas, vale o prazo da operação. */
export const termText = (c: { openEnded: boolean; deadlineDays: number; startMs: number; endMs: number }) => c.openEnded ? (c.deadlineDays ? `${c.deadlineDays} ${c.deadlineDays === 1 ? "dia" : "dias"}` : "prazo da operação") : periodText(c.startMs, c.endMs);

export type OfferPhase = "pending" | "active" | "done" | "expired" | "declined" | "cancelled";
/** Em que pé está a oferta para o motorista: para responder, em andamento, concluída, prazo perdido, recusada ou cancelada. */
export const offerPhase = (offer: RewardOffer): OfferPhase => {
  if (offer.status === "pending") return "pending"; if (offer.status === "declined") return "declined"; if (offer.status === "cancelled") return "cancelled";
  if (offer.expired || offer.goalMissed) return "expired"; return offerCompleted(offer) ? "done" : "active";
};
/** Texto do motivo da perda do pagamento: prazo vencido ou meta de ganhos não atingida. */
export const lostLabel = (offer: { goalMissed?: boolean }) => offer.goalMissed ? "Meta não atingida" : "Prazo perdido";
export const PHASE_LABEL: Record<OfferPhase, string> = { pending: "Responder", active: "Em andamento", done: "Concluída", expired: "Prazo perdido", declined: "Recusada", cancelled: "Cancelada" };
export const PHASE_TONE: Record<OfferPhase, string> = { pending: "warn", active: "warn", done: "good", expired: "late", declined: "muted", cancelled: "muted" };
/** Tempo que falta para o prazo: "3 dias", "5 h", "menos de 1 h" ou "encerrado". */
export const timeLeftText = (deadlineMs: number, now: number): string => {
  if (!deadlineMs) return ""; const left = deadlineMs - now;
  if (left <= 0) return "encerrado"; const hours = Math.floor(left / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} dias`; if (hours >= 24) return "1 dia"; return hours >= 1 ? `${hours} h` : "menos de 1 h";
};

/** Oferta de um trabalho que a empresa já encaminhou para a fila do motorista (as condições são confirmadas ao iniciar o trabalho). */
export const isDispatched = (offer: Pick<RewardOffer, "jobId">) => Boolean(offer.jobId);
/** Condições do pagamento em frases curtas, para o aviso ao iniciar o trabalho. */
export function termsLines(offer: Pick<RewardOffer, "perTripCents" | "maxTripsPerDriver" | "goalCents" | "deadlineMs" | "payDay">, now: number): string[] {
  const money = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = [`${money(offer.perTripCents)} por viagem${offer.maxTripsPerDriver ? ` · ${offer.maxTripsPerDriver} viagens` : ""}.`];
  if (offer.deadlineMs) lines.push(`Conclua a operação no prazo (${timeLeftText(offer.deadlineMs, now) || "prazo da operação"}).`);
  return lines;
}
