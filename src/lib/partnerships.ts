/**
 * Parcerias B2P — tipos e regras puras do cliente (sem Firebase), testadas isoladamente.
 * Uma empresa (contratante) envia uma oferta de operação a outra (executora); a executora aceita e designa um motorista
 * da própria equipe. Só a pontuação do ranking de empresas vai para a contratante. Sem carteira, cobrança ou comissão.
 */
export type PartnershipStatus = "pending" | "declined" | "cancelled" | "accepted" | "active" | "completed";
export type PartnershipRole = "contractor" | "executor";
export type PartnershipLedgerEntry = { n: number; at: number; cents: number; tripId: string };

export type Partnership = {
  id: string;
  status: PartnershipStatus;
  contractorCompanyId: string; executorCompanyId: string; contractorName: string; executorName: string;
  simulatorId: string; currency: string;
  operationName: string; totalTrips: number; trailerRequirement: string | null;
  deadlineAt: string; deadlineMs: number; conditions: string; goalAmountCents: number | null;
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
    deadlineAt: text(raw.deadlineAt), deadlineMs: num(raw.deadlineMs) || ms(raw.deadlineAt),
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
  if (p.status === "pending") return role === "executor" ? "Responder oferta" : `Aguardando ${p.executorName}`;
  if (p.status === "accepted") return p.jobId ? "Aguardando início" : role === "executor" ? "Designar motorista" : `${p.executorName} vai designar o motorista`;
  return STATUS_LABEL[p.status];
}

export type Pace = { tone: "good" | "warn" | "late" | "idle"; label: string };
/** "No ritmo do prazo": compara o avanço de viagens com o tempo decorrido entre a designação e o prazo final. */
export function paceOf(p: Pick<Partnership, "status" | "progress" | "totalTrips" | "deadlineMs" | "createdAtMs">, now: number): Pace {
  if (p.status === "completed") return { tone: "good", label: "Concluída" };
  if (p.status !== "active" && p.status !== "accepted") return { tone: "idle", label: "" };
  if (p.deadlineMs && now > p.deadlineMs) return { tone: "late", label: "Prazo vencido" };
  if (!p.deadlineMs || !p.totalTrips) return { tone: "idle", label: "" };
  const start = p.createdAtMs || now, span = Math.max(1, p.deadlineMs - start);
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
  try { return new Intl.NumberFormat(CURRENCY_LOCALE[currency] || "pt-BR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(cents) / 100); }
  catch { return `${currency} ${Math.round(cents / 100)}`; }
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
  deadlineAt: string; conditions: string; goal: string;
};
export const emptyDraft = (executorCompanyId = ""): OfferDraft => ({ executorCompanyId, operationName: "", totalTrips: "", trailerRequirement: "", deadlineAt: "", conditions: "", goal: "" });

/** Validação do formulário antes de chamar o servidor (o servidor valida de novo). Devolve a 1ª mensagem ou "". */
export function validateDraft(draft: OfferDraft, now: number, trailerless: boolean): string {
  if (!draft.executorCompanyId) return "Escolha a empresa parceira.";
  if (draft.operationName.trim().length < 3) return "Informe o nome da operação (mínimo de 3 letras).";
  const trips = Number(draft.totalTrips);
  if (!Number.isSafeInteger(trips) || trips < 1 || trips > 500) return "A quantidade de viagens deve ficar entre 1 e 500.";
  if (!trailerless && draft.trailerRequirement.trim().length > 0 && draft.trailerRequirement.trim().length < 2) return "Informe o reboque exigido ou deixe em branco.";
  const deadline = Date.parse(draft.deadlineAt);
  if (!Number.isFinite(deadline)) return "Informe o prazo final.";
  if (deadline < now + 10 * 60_000) return "O prazo final precisa estar no futuro.";
  if (deadline > now + 120 * 86_400_000) return "O prazo final pode ser de, no máximo, 120 dias.";
  if (draft.conditions.length > MAX_CONDITIONS) return `As condições aceitam até ${MAX_CONDITIONS} caracteres.`;
  if (draft.goal.trim() && parseMoneyToCents(draft.goal) === null) return "A meta de ganhos é inválida.";
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
