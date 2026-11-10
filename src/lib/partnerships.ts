/**
 * Parcerias B2P — tipos e regras puras do cliente (sem Firebase), testadas isoladamente.
 * Uma empresa (contratante) envia uma oferta de operação a outra (executora); a executora aceita e designa um motorista
 * da própria equipe. Só a pontuação do ranking de empresas vai para a contratante. Sem carteira, cobrança ou comissão.
 */
export type PartnershipStatus = "pending" | "declined" | "cancelled" | "accepted" | "active" | "completed";
export type PartnershipRole = "contractor" | "executor";
export type PaymentStatus = "pending" | "paid" | "settled";
export type Settlement = { agreedCents: number; late: boolean; penaltyPercent: number; discountCents: number; finalCents: number; deadlineMs: number; completedAtMs: number };
export type PartnershipLedgerEntry = { n: number; at: number; cents: number; tripId: string };

export type Partnership = {
  id: string;
  status: PartnershipStatus;
  contractorCompanyId: string; executorCompanyId: string; contractorName: string; executorName: string;
  simulatorId: string; currency: string;
  operationName: string; totalTrips: number; trailerRequirement: string | null;
  /** Prazo combinado em dias; só começa a contar quando a executora aceita (`acceptedAtMs`). `deadlineMs` = 0 até lá. */
  durationDays: number; acceptedAtMs: number; deadlineAt: string; deadlineMs: number; conditions: string; goalAmountCents: number | null;
  /** Valor do acordo (negociado entre as empresas, fora do NVU). `settlement`/`payment` só existem depois da conclusão. */
  agreedAmountCents: number | null; settlement: Settlement | null; payment: { status: PaymentStatus; paidAtMs: number; settledAtMs: number } | null; completedAtMs: number;
  progress: number; earningsCents: number; bestCents: number; averageCents: number; ledger: PartnershipLedgerEntry[];
  jobId: string | null; driverId: string | null; driverName?: string; vehicleName?: string; vehiclePlate?: string; trailerName?: string;
  startPhotoUrl?: string;
  createdAtMs: number; updatedAtMs: number;
};

export const PARTNERSHIP_ID_PREFIX = "po_";
export const PARTNERSHIP_CONTRACT_PREFIX = "pc_";
export const MAX_CONDITIONS = 300;

/** Contratos ocultos criados na designação: nunca aparecem em catálogos, filas ou atribuição manual. */
export const isPartnershipContract = (contract: { id?: unknown; partnershipId?: unknown; partnership?: unknown } | null | undefined): boolean =>
  Boolean(contract && (contract.partnership === true || contract.partnershipId || String(contract.id || "").startsWith(PARTNERSHIP_CONTRACT_PREFIX)));

const ms = (value: any): number => value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value === "number" ? value : Date.parse(String(value || "")) || 0);

/** Converte o documento do Firestore no formato do app (defensivo: documento incompleto nunca derruba a tela). */
export function normalizePartnership(id: string, raw: Record<string, any>): Partnership {
  const text = (value: unknown) => String(value ?? "").trim();
  const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const status = (["pending", "declined", "cancelled", "accepted", "active", "completed"] as const).find(item => item === raw.status) || "pending";
  return {
    id, status,
    contractorCompanyId: text(raw.contractorCompanyId), executorCompanyId: text(raw.executorCompanyId),
    contractorName: text(raw.contractorName) || "Empresa", executorName: text(raw.executorName) || "Empresa",
    simulatorId: text(raw.simulatorId), currency: text(raw.currency) || "BRL",
    operationName: text(raw.operationName) || "Operação", totalTrips: Math.max(0, num(raw.totalTrips)),
    trailerRequirement: text(raw.trailerRequirement) || null,
    durationDays: Math.max(0, Math.round(num(raw.durationDays))) || (num(raw.deadlineMs) && ms(raw.createdAt) ? Math.max(1, Math.round((num(raw.deadlineMs) - ms(raw.createdAt)) / 86_400_000)) : 0),
    agreedAmountCents: Number.isSafeInteger(raw.agreedAmountCents) && raw.agreedAmountCents > 0 ? raw.agreedAmountCents : null, completedAtMs: num(raw.completedAtMs),
    settlement: raw.settlement && Number.isSafeInteger(raw.settlement.finalCents) ? { agreedCents: num(raw.settlement.agreedCents), late: Boolean(raw.settlement.late), penaltyPercent: num(raw.settlement.penaltyPercent), discountCents: num(raw.settlement.discountCents), finalCents: num(raw.settlement.finalCents), deadlineMs: num(raw.settlement.deadlineMs), completedAtMs: num(raw.settlement.completedAtMs) } : null,
    payment: raw.payment && ["pending", "paid", "settled"].includes(raw.payment.status) ? { status: raw.payment.status, paidAtMs: ms(raw.payment.paidAt), settledAtMs: ms(raw.payment.settledAt) } : null,
    acceptedAtMs: ms(raw.acceptedAt), deadlineAt: text(raw.deadlineAt), deadlineMs: num(raw.deadlineMs) || ms(raw.deadlineAt),
    conditions: text(raw.conditions), goalAmountCents: Number.isSafeInteger(raw.goalAmountCents) && raw.goalAmountCents > 0 ? raw.goalAmountCents : null,
    progress: Math.max(0, num(raw.progress)), earningsCents: Math.max(0, num(raw.earningsCents)),
    bestCents: Math.max(0, num(raw.bestCents)), averageCents: Math.max(0, num(raw.averageCents)),
    ledger: Array.isArray(raw.ledger) ? raw.ledger.filter((e: any) => e && typeof e === "object").map((e: any) => ({ n: num(e.n), at: num(e.at), cents: num(e.cents), tripId: text(e.tripId) })) : [],
    jobId: text(raw.jobId) || null, driverId: text(raw.driverId) || null, driverName: text(raw.driverName) || undefined,
    vehicleName: text(raw.vehicleName) || undefined, vehiclePlate: text(raw.vehiclePlate) || undefined, trailerName: text(raw.trailerName) || undefined,
    startPhotoUrl: text(raw.startPhotoUrl) || undefined,
    createdAtMs: ms(raw.createdAt), updatedAtMs: ms(raw.updatedAt),
  };
}

export const roleIn = (p: Pick<Partnership, "contractorCompanyId" | "executorCompanyId">, companyId: string): PartnershipRole | null =>
  p.contractorCompanyId === companyId ? "contractor" : p.executorCompanyId === companyId ? "executor" : null;

export type PartnershipSection = "action" | "running" | "waiting" | "done" | "closed";
/** Em qual seção da página a parceria aparece para a empresa que está olhando. */
export function sectionFor(p: Pick<Partnership, "status" | "jobId" | "contractorCompanyId" | "executorCompanyId">, companyId: string): PartnershipSection {
  const role = roleIn(p, companyId);
  if (p.status === "completed") return "done";
  if (p.status === "declined" || p.status === "cancelled") return "closed";
  if (p.status === "pending") return role === "executor" ? "action" : "waiting";
  if (p.status === "accepted" && !p.jobId) return role === "executor" ? "action" : "waiting";
  return "running";
}

export const STATUS_LABEL: Record<PartnershipStatus, string> = {
  pending: "Aguardando resposta", accepted: "Aceita", active: "Em andamento", completed: "Concluída", declined: "Recusada", cancelled: "Cancelada",
};
/** Texto curto de estado, pensado para quem olha (contratante ou executora). */
export function statusText(p: Pick<Partnership, "status" | "jobId" | "contractorName" | "executorName">, role: PartnershipRole | null): string {
  if (p.status === "pending") return role === "executor" ? "Responder oferta" : `Aguardando ${shortName(p.executorName)}`;
  if (p.status === "accepted") return p.jobId ? "Aguardando início" : role === "executor" ? "Designar motorista" : `${shortName(p.executorName)} vai designar o motorista`;
  return STATUS_LABEL[p.status];
}

export type Pace = { tone: "good" | "warn" | "late" | "idle"; label: string };
/** "No ritmo do prazo": compara o avanço de viagens com o tempo decorrido entre a designação e o prazo final. */
export function paceOf(p: Pick<Partnership, "status" | "progress" | "totalTrips" | "deadlineMs" | "createdAtMs"> & { acceptedAtMs?: number }, now: number): Pace {
  if (p.status === "completed") return { tone: "good", label: "Concluída" };
  if (p.status !== "active" && p.status !== "accepted") return { tone: "idle", label: "" };
  if (p.deadlineMs && now > p.deadlineMs) return { tone: "late", label: "Prazo vencido" };
  if (!p.deadlineMs || !p.totalTrips) return { tone: "idle", label: "" };
  const start = p.acceptedAtMs || p.createdAtMs || now, span = Math.max(1, p.deadlineMs - start);
  const elapsed = Math.min(1, Math.max(0, (now - start) / span)), done = Math.min(1, p.progress / p.totalTrips);
  if (done + 0.1 >= elapsed) return { tone: "good", label: "No ritmo do prazo" };
  if (done + 0.3 >= elapsed) return { tone: "warn", label: "Atenção ao prazo" };
  return { tone: "late", label: "Abaixo do ritmo" };
}

export function remainingText(deadlineMs: number, now: number): string {
  if (!deadlineMs) return "";
  const diff = deadlineMs - now;
  if (diff <= 0) return "Prazo encerrado";
  const days = Math.floor(diff / 86_400_000), hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days} ${days === 1 ? "dia" : "dias"}${hours ? ` e ${hours} h` : ""}`;
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return hours ? `${hours} h${minutes ? ` ${minutes} min` : ""}` : `${Math.max(1, minutes)} min`;
}

const CURRENCY_LOCALE: Record<string, string> = { BRL: "pt-BR", EUR: "de-DE", USD: "en-US", GBP: "en-GB" };
export function formatMoney(cents: number, currency = "BRL"): string {
  try { return new Intl.NumberFormat(CURRENCY_LOCALE[currency] || "pt-BR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(cents) / 100); }
  catch { return `${currency} ${(Math.round(cents) / 100).toFixed(2).replace(".", ",")}`; }
}
/** Máscara de valor digitado: só os dígitos viram centavos ("2500000" → "25.000,00"); vazio continua vazio. */
export function maskMoney(input: string): string {
  const digits = String(input || "").replace(/\D/g, "").replace(/^0+/, "").slice(0, 11);
  if (!digits) return "";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(digits) / 100);
}
/** Centavos → texto da máscara ("2500000" → "25.000,00"). */
export const centsToMasked = (cents: number | null | undefined): string => cents && cents > 0 ? maskMoney(String(Math.round(cents))) : "";
const NAME_FILLERS = new Set(["e", "de", "do", "da", "dos", "das", "&", "-", "–", "—", "+"]);
/** Só o primeiro e o segundo nome da empresa ("Cooper log Transporte e Logística" → "Cooper log"). */
export function shortName(name: string): string {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words.join(" ");
  return words.length > 1 && NAME_FILLERS.has(words[1].toLowerCase()) ? words[0] : words.slice(0, 2).join(" ");
}
/** "12500" → 1250000 centavos; aceita "12.500", "12.500,50" e "12500,5". Vazio = sem meta. */
export function parseMoneyToCents(input: string): number | null {
  const raw = String(input || "").trim().replace(/[^\d.,]/g, "");
  if (!raw) return null;
  const comma = raw.lastIndexOf(","), dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma >= 0 && comma > dot) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (dot >= 0 && comma < 0 && raw.length - dot - 1 === 3 && raw.indexOf(".") !== dot) normalized = raw.replace(/\./g, "");
  else if (dot >= 0 && comma < 0 && raw.length - dot - 1 === 3) normalized = raw.replace(/\./g, "");
  else normalized = raw.replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

/** A oferta define só reboque (opcional), prazo, viagens, meta e condições. O veículo é escolhido pela executora. */
export type OfferDraft = {
  executorCompanyId: string; operationName: string; totalTrips: string; trailerRequirement: string;
  /** Prazo em dias, contado a partir do aceite da parceira. */
  durationDays: string; conditions: string; goal: string;
  /** Valor do acordo (R$) — negociado entre as empresas; opcional. */
  agreed: string;
};
export const emptyDraft = (executorCompanyId = ""): OfferDraft => ({ executorCompanyId, operationName: "", totalTrips: "", trailerRequirement: "", durationDays: "", conditions: "", goal: "", agreed: "" });

/** Validação do formulário antes de chamar o servidor (o servidor valida de novo). Devolve a 1ª mensagem ou "". */
export function validateDraft(draft: OfferDraft, now: number, trailerless: boolean): string {
  if (!draft.executorCompanyId) return "Escolha a empresa parceira.";
  if (draft.operationName.trim().length < 3) return "Informe o nome da operação (mínimo de 3 letras).";
  const trips = Number(draft.totalTrips);
  if (!Number.isSafeInteger(trips) || trips < 1 || trips > 500) return "A quantidade de viagens deve ficar entre 1 e 500.";
  if (!trailerless && draft.trailerRequirement.trim().length > 0 && draft.trailerRequirement.trim().length < 2) return "Informe o reboque exigido ou deixe em branco.";
  const days = Number(draft.durationDays);
  if (!Number.isSafeInteger(days) || days < 1 || days > 120) return "O prazo deve ficar entre 1 e 120 dias.";
  if (draft.conditions.length > MAX_CONDITIONS) return `As condições aceitam até ${MAX_CONDITIONS} caracteres.`;
  if (draft.goal.trim() && parseMoneyToCents(draft.goal) === null) return "A meta de ganhos é inválida.";
  if (draft.agreed.trim() && parseMoneyToCents(draft.agreed) === null) return "O valor do acordo é inválido.";
  return "";
}

export type PartnershipResults = {
  earningsCents: number; goalPercent: number | null; averageCents: number; bestCents: number; bestN: number; trips: number; totalTrips: number;
  bars: { n: number; cents: number; height: number }[];
};
/** Resultados consultáveis ao final: ganhos totais, % da meta, média, melhor viagem e barras do gráfico. */
export function resultsOf(p: Pick<Partnership, "ledger" | "goalAmountCents" | "totalTrips" | "earningsCents" | "averageCents" | "bestCents" | "progress">): PartnershipResults {
  const entries = p.ledger.length ? p.ledger : [];
  const earnings = entries.length ? entries.reduce((sum, e) => sum + e.cents, 0) : p.earningsCents;
  const best = entries.reduce((top, e) => e.cents > top.cents ? e : top, { n: 0, cents: 0 });
  const max = Math.max(1, ...entries.map(e => e.cents));
  return {
    earningsCents: earnings,
    goalPercent: p.goalAmountCents ? Math.min(999, Math.round(earnings / p.goalAmountCents * 100)) : null,
    averageCents: entries.length ? Math.round(earnings / entries.length) : p.averageCents,
    bestCents: best.cents || p.bestCents, bestN: best.n, trips: entries.length || p.progress, totalTrips: p.totalTrips,
    bars: entries.map(e => ({ n: e.n, cents: e.cents, height: Math.max(8, Math.round(e.cents / max * 100)) })),
  };
}

/** Mensagens de erro do servidor em português (a mensagem do callable já vem pronta; este filtro só limpa o prefixo técnico). */
export function partnershipErrorMessage(error: unknown, fallback = "Não foi possível concluir. Tente novamente."): string {
  const e = error as { message?: string; code?: string };
  const message = String(e?.message || "").replace(/^(functions|firebase)[^:]*:\s*/i, "").trim();
  if (!message || /internal|unavailable|deadline-exceeded/i.test(String(e?.code || "")) && message.length < 4) return fallback;
  return message;
}

/** Pip da rota (20): proporção concluída da operação. */
export function pipsFor(progress: number, total: number, pips = 20): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(pips, Math.round(Math.min(1, progress / total) * pips)));
}

const fold = (value: string): string => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Mesma regra do servidor: o veículo/reboque oferecido deve ser o exigido (sem acento/caixa; a exigência pode ser parte do nome). */
export function matchesRequirement(requirement: string | null | undefined, assetName: string): boolean {
  const wanted = fold(requirement || "");
  if (!wanted) return true;
  const have = fold(assetName || "");
  return have === wanted || have.includes(wanted) || wanted.includes(have) && have.length >= 3;
}

export const initialsOf = (name: string): string => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  const clean = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "");
  // Sigla na frente ("DC Transportes" → "DC"); senão as duas primeiras letras ("CTS" → "CT"; "Rota Sul" → "RS").
  const first = clean(parts[0]);
  const letters = parts.length > 1 && /^[\p{Lu}\p{N}]{2,3}$/u.test(first) ? first : parts.length === 1 ? first.slice(0, 2) : parts.slice(0, 2).map(part => clean(part)[0] || "").join("");
  return (letters || "··").toUpperCase();
};

// ───────────── apoio às telas (Nova oferta e Designar trabalho) ─────────────

/** Próximo nome sugerido para a oferta ("Operação 032"): maior número já usado pela empresa + 1 (sem número: contagem + 1). */
export function suggestOperationName(rows: Pick<Partnership, "contractorCompanyId" | "operationName">[], companyId: string): string {
  const mine = rows.filter(row => row.contractorCompanyId === companyId);
  const numbers = mine.map(row => Number(/(\d{1,6})\s*$/.exec(row.operationName)?.[1])).filter(value => Number.isSafeInteger(value) && value > 0);
  const next = numbers.length ? Math.max(...numbers) + 1 : mine.length + 1;
  return `Operação ${String(next).padStart(3, "0")}`;
}

export const TRIP_PRESETS = [5, 10, 20, 50] as const;
export const DURATION_PRESETS = [3, 5, 7, 15, 30] as const;
export const clampTrips = (value: number): number => Math.min(500, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
export const clampDays = (value: number): number => Math.min(120, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
/** "5 dias" / "1 dia". */
export const formatDays = (days: number): string => `${days} ${days === 1 ? "dia" : "dias"}`;
const two = (value: number) => String(value).padStart(2, "0");
const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"], MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "qui, 13 nov · 18:00" (hora local). */
export function formatDeadline(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const date = new Date(ms);
  return `${WEEKDAY[date.getDay()]}, ${date.getDate()} ${MONTH[date.getMonth()]} · ${two(date.getHours())}:${two(date.getMinutes())}`;
}
/** Valor médio por viagem da meta (centavos), só com meta e viagens válidas. */
export const perTripCents = (goalCents: number | null, trips: number): number | null =>
  goalCents && goalCents > 0 && Number.isSafeInteger(trips) && trips > 0 ? Math.round(goalCents / trips) : null;

/** Primeira pendência da oferta, em poucas palavras (aparece no rodapé do formulário). Vazio = pronta para enviar. */
export function offerHint(draft: OfferDraft, now: number, trailerless: boolean): string {
  if (!draft.executorCompanyId) return "Escolha a empresa parceira";
  if (draft.operationName.trim().length < 3) return "Dê um nome à operação";
  const trips = Number(draft.totalTrips);
  if (!Number.isSafeInteger(trips) || trips < 1 || trips > 500) return "Informe de 1 a 500 viagens";
  const days = Number(draft.durationDays);
  if (!Number.isSafeInteger(days) || days < 1 || days > 120) return "Defina o prazo em dias (1 a 120)";
  return validateDraft(draft, now, trailerless) ? "Revise os dados da oferta" : "";
}

/** Resumo de uma linha da oferta (ex.: "CTS · 12 viagens · 5 dias"). */
export function offerSummary(draft: OfferDraft, partnerName: string): string {
  const trips = Number(draft.totalTrips), days = Number(draft.durationDays);
  return [partnerName || "Sem parceira", Number.isFinite(trips) && trips > 0 ? `${trips} ${trips === 1 ? "viagem" : "viagens"}` : "", Number.isSafeInteger(days) && days > 0 ? formatDays(days) : ""].filter(Boolean).join(" · ");
}

/** Último veículo da própria frota que o motorista usou (mais recente), para sugerir na designação. */
export function lastVehicleOf(jobs: { driverId?: string; vehicleId?: string; assignedAt?: string; createdAt?: string; startedAt?: string }[], driverId: string, ownVehicleIds: ReadonlySet<string>): string | null {
  let best: { id: string; at: number } | null = null;
  for (const job of jobs) {
    if (job.driverId !== driverId || !job.vehicleId || !ownVehicleIds.has(job.vehicleId)) continue;
    const at = Date.parse(String(job.assignedAt || job.startedAt || job.createdAt || "")) || 0;
    if (!best || at > best.at) best = { id: job.vehicleId, at };
  }
  return best?.id ?? null;
}

/**
 * Indicador da linha "Parcerias B2P" da Central: o que pede ação (oferta recebida, designar motorista) e as novidades desde a
 * última vez que a empresa abriu a página (oferta aceita/recusada/cancelada e operação concluída). Progresso de viagens não conta.
 */
export type PartnershipAlerts = { toAnswer: number; news: number; total: number; label: string };
export function partnershipAlerts(rows: Pick<Partnership, "status" | "jobId" | "contractorCompanyId" | "executorCompanyId" | "updatedAtMs">[], companyId: string, seenMs: number): PartnershipAlerts {
  let toAnswer = 0, news = 0;
  for (const row of rows) {
    const role = roleIn(row, companyId);
    if (!role) continue;
    if (sectionFor(row, companyId) === "action") { toAnswer++; continue; }
    if (row.updatedAtMs <= seenMs) continue;
    const relevant = role === "contractor" ? ["accepted", "declined", "cancelled", "completed"] : ["cancelled", "completed"];
    if (relevant.includes(row.status)) news++;
  }
  const parts = [toAnswer ? `${toAnswer} para responder` : "", news ? `${news} ${news === 1 ? "novidade" : "novidades"}` : ""].filter(Boolean);
  return { toAnswer, news, total: toAnswer + news, label: parts.join(" · ") };
}

// ───────────── valor do acordo, liquidação e carteira ─────────────
/** Mesma regra do servidor: concluída depois do prazo = valor combinado menos 25%. */
export const LATE_PENALTY_PERCENT = 25;
export function computeSettlement(agreedCents: number | null | undefined, deadlineMs: number, completedAtMs: number): Settlement | null {
  if (!Number.isSafeInteger(agreedCents) || (agreedCents as number) < 1) return null;
  const agreed = agreedCents as number, late = Number.isFinite(deadlineMs) && deadlineMs > 0 && completedAtMs > deadlineMs;
  const finalCents = late ? Math.round(agreed * (100 - LATE_PENALTY_PERCENT) / 100) : agreed;
  return { agreedCents: agreed, late, penaltyPercent: late ? LATE_PENALTY_PERCENT : 0, discountCents: agreed - finalCents, finalCents, deadlineMs: deadlineMs || 0, completedAtMs };
}

export type WalletKind = "ganho" | "investimento";
/** previsto = operação em andamento (valor combinado); a_pagar/a_receber = concluída, aguardando pagamento; pago = contratante informou, aguardando confirmação; liquidado = confirmado. */
export type WalletStatus = "previsto" | "a_pagar" | "a_receber" | "pago" | "liquidado";
export type WalletEntry = { id: string; partnershipId: string; kind: WalletKind; title: string; counterpart: string; amountCents: number; agreedCents: number; discountCents: number; late: boolean; status: WalletStatus; atMs: number; currency: string };
export const WALLET_STATUS_LABEL: Record<WalletStatus, string> = { previsto: "Previsto", a_pagar: "A pagar", a_receber: "A receber", pago: "Pago · aguarda confirmação", liquidado: "Liquidado" };

/** Movimentos da carteira da empresa: ganhos (quando executa) e investimentos (quando contrata), só de parcerias com valor combinado. */
export function walletEntries(rows: Partnership[], companyId: string): WalletEntry[] {
  const entries: WalletEntry[] = [];
  for (const p of rows) {
    const role = roleIn(p, companyId);
    if (!role || !p.agreedAmountCents || ["pending", "declined", "cancelled"].includes(p.status)) continue;
    const kind: WalletKind = role === "contractor" ? "investimento" : "ganho";
    const counterpart = shortName(role === "contractor" ? p.executorName : p.contractorName);
    const base = { id: `${p.id}:${kind}`, partnershipId: p.id, kind, title: p.operationName, counterpart, currency: p.currency };
    if (p.status === "completed" && p.settlement && p.payment) {
      const paid = p.payment.status;
      const status: WalletStatus = paid === "settled" ? "liquidado" : paid === "paid" ? "pago" : role === "contractor" ? "a_pagar" : "a_receber";
      entries.push({ ...base, amountCents: p.settlement.finalCents, agreedCents: p.settlement.agreedCents, discountCents: p.settlement.discountCents, late: p.settlement.late, status, atMs: p.payment.settledAtMs || p.payment.paidAtMs || p.settlement.completedAtMs || p.updatedAtMs });
    } else if (p.status !== "completed") {
      entries.push({ ...base, amountCents: p.agreedAmountCents, agreedCents: p.agreedAmountCents, discountCents: 0, late: false, status: "previsto", atMs: p.acceptedAtMs || p.createdAtMs });
    }
  }
  return entries.sort((a, b) => b.atMs - a.atMs || a.id.localeCompare(b.id));
}

export type WalletTotals = {
  /** Ganhos em parcerias */ toReceiveCents: number; receivedCents: number; forecastGainCents: number;
  /** Investimentos em parcerias */ toPayCents: number; paidCents: number; forecastInvestCents: number;
  /** Recebido menos pago (liquidado) */ netCents: number;
};
export function walletTotals(entries: WalletEntry[]): WalletTotals {
  const t: WalletTotals = { toReceiveCents: 0, receivedCents: 0, forecastGainCents: 0, toPayCents: 0, paidCents: 0, forecastInvestCents: 0, netCents: 0 };
  for (const e of entries) {
    if (e.kind === "ganho") { if (e.status === "liquidado") t.receivedCents += e.amountCents; else if (e.status === "previsto") t.forecastGainCents += e.amountCents; else t.toReceiveCents += e.amountCents; }
    else { if (e.status === "liquidado" || e.status === "pago") t.paidCents += e.amountCents; else if (e.status === "previsto") t.forecastInvestCents += e.amountCents; else t.toPayCents += e.amountCents; }
  }
  t.netCents = t.receivedCents - t.paidCents;
  return t;
}
