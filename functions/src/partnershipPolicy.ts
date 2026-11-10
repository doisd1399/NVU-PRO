import { fail, text } from "./operationalCommandPolicy";
import { isCanonicalConfirmedTrip, type CanonicalConfirmationScope } from "./isCanonicalConfirmedTrip";

/**
 * Parcerias B2P — regras puras (sem banco), testadas isoladamente.
 *
 * Uma empresa (contratante) envia uma oferta de operação a outra (executora). Ao aceitar, a executora designa um
 * motorista da própria equipe. O trabalho é um trabalho comum da EXECUTORA (mesmo vínculo, mesmas validações de
 * viagem); só a pontuação do ranking de EMPRESAS vai para a contratante (campo `scoreCompanyId` da viagem).
 * Nada de carteira, cobrança, pagamento, comissão ou reembolso: a meta de ganhos é apenas de acompanhamento.
 */
export const PARTNERSHIPS = "partnerships";
export const PARTNERSHIP_CONTRACT_PREFIX = "pc_";
export const PARTNERSHIP_PHOTO_PREFIX = "partnership-start-photos";
export type PartnershipStatus = "pending" | "declined" | "cancelled" | "accepted" | "active" | "completed";
export const OPEN_STATUSES: readonly PartnershipStatus[] = ["pending", "accepted", "active"];
export const MAX_PENDING_OFFERS = 20;
export const MAX_LEDGER = 500;

export const partnershipContractId = (partnershipId: string): string => `${PARTNERSHIP_CONTRACT_PREFIX}${partnershipId}`;
export const isPartnershipContractId = (value: unknown): boolean => typeof value === "string" && value.startsWith(PARTNERSHIP_CONTRACT_PREFIX);

/**
 * A oferta define só o que a contratante pode exigir: reboque (opcional), PRAZO EM DIAS (o relógio só começa quando a
 * executora aceita), quantidade de viagens, meta e as condições do acordo. O VEÍCULO é escolhido pela empresa que vai operar (a executora), na designação.
 */
export type OfferInput = {
  contractorCompanyId: string; executorCompanyId: string; operationName: string; totalTrips: number;
  trailerRequirement: string | null; durationDays: number; conditions: string;
  /** Meta de ganhos (só acompanhamento). */
  goalAmountCents: number | null;
  /** Valor do acordo entre as empresas (negociado fora do NVU), base do cálculo a pagar/a receber. */
  agreedAmountCents: number | null; requestId: string;
};
export const MAX_DURATION_DAYS = 120;

const cleanText = (value: unknown, max: number): string => text(value).replace(/\s+/g, " ").slice(0, max);
const idLike = (value: unknown, label: string): string => {
  const v = text(value);
  if (!v || v.length > 180 || /[\/\0]/.test(v) || v === "." || v === "..") fail("invalid-argument", `${label} inválido.`);
  return v;
};

/** Validates and normalizes the offer. `trailerless` simulators never carry a trailer requirement. */
export function normalizeOffer(raw: unknown, now: number, trailerless: boolean): OfferInput {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const contractorCompanyId = idLike(data.contractorCompanyId, "Empresa contratante");
  const executorCompanyId = idLike(data.executorCompanyId, "Empresa parceira");
  if (contractorCompanyId === executorCompanyId) fail("invalid-argument", "Escolha outra empresa como parceira.");
  const operationName = cleanText(data.operationName, 60);
  if (operationName.length < 3) fail("invalid-argument", "Informe o nome da operação (mínimo de 3 letras).");
  const totalTrips = Number(data.totalTrips);
  if (!Number.isSafeInteger(totalTrips) || totalTrips < 1 || totalTrips > 500) fail("invalid-argument", "A quantidade de viagens deve ficar entre 1 e 500.");
  const trailerText = cleanText(data.trailerRequirement, 80);
  const trailerRequirement = trailerless ? null : trailerText || null;
  if (trailerRequirement && operationName.toLowerCase() === trailerRequirement.toLowerCase()) fail("invalid-argument", "O nome da operação não pode ser igual ao nome do reboque.");
  // Prazo em dias, contado a partir do aceite. App antigo que ainda envie uma data final é convertido em dias (arredondando para cima).
  let durationDays = Number(data.durationDays);
  if ((data.durationDays === undefined || data.durationDays === null || data.durationDays === "") && text(data.deadlineAt)) {
    const legacy = Date.parse(text(data.deadlineAt));
    if (!Number.isFinite(legacy)) fail("invalid-argument", "Informe o prazo em dias.");
    durationDays = Math.ceil((legacy - now) / 86_400_000);
  }
  if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) fail("invalid-argument", `O prazo deve ficar entre 1 e ${MAX_DURATION_DAYS} dias.`);
  const conditions = text(data.conditions).slice(0, 300);
  if (text(data.conditions).length > 300) fail("invalid-argument", "As condições do acordo aceitam até 300 caracteres.");
  const money = (value: unknown, label: string): number | null => {
    if (value === undefined || value === null || value === "") return null;
    const cents = Number(value);
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000_000) fail("invalid-argument", `${label} é inválido.`);
    return cents;
  };
  const goalAmountCents = money(data.goalAmountCents, "A meta de ganhos"), agreedAmountCents = money(data.agreedAmountCents, "O valor do acordo");
  return { contractorCompanyId, executorCompanyId, operationName, totalTrips, trailerRequirement,
    durationDays, conditions, goalAmountCents, agreedAmountCents, requestId: idLike(data.requestId, "Pedido") };
}

/**
 * Empresa que pode participar de uma parceria: ativa, não excluída e não arquivada/suspensa (mesma regra do catálogo
 * "Empresas" e da lista de parceiras do app). Frota de simulador desativado fica com status "archived".
 */
const UNAVAILABLE_STATUS = ["deleted", "archived", "disabled", "blocked", "pending", "rejected", "suspended", "inactive"];
export function isPartnerAvailable(company: Record<string, any> | null | undefined): boolean {
  if (!company) return false;
  if (company.deleted === true || company.isDeleted === true || company.softDeleted === true) return false;
  if (company.active === false || company.isActive === false) return false;
  return !UNAVAILABLE_STATUS.includes(text(company.status || "active").toLowerCase());
}

const fold = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The offered trailer must be what was asked for (accent- and case-insensitive; the requirement may be part of the name). */
export function matchesRequirement(requirement: string | null | undefined, assetName: string): boolean {
  const wanted = fold(requirement || "");
  if (!wanted) return true;
  const have = fold(assetName || "");
  return have === wanted || have.includes(wanted) || wanted.includes(have) && have.length >= 3;
}

/** Partnership lifecycle follows the physical job, never the other way around. */
export function statusFromJob(jobStatus: unknown): PartnershipStatus | null {
  const status = text(jobStatus).toLowerCase();
  if (status === "pending") return "accepted";
  if (["active", "delayed", "awaiting_completion"].includes(status)) return "active";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return null;
}
const RANK: Record<PartnershipStatus, number> = { pending: 0, accepted: 1, active: 2, completed: 3, declined: 3, cancelled: 3 };
/** A finished partnership never reopens; open states only move forward. */
export function mayTransition(from: PartnershipStatus, to: PartnershipStatus): boolean {
  if (from === to) return true;
  if (["completed", "declined", "cancelled"].includes(from)) return false;
  return RANK[to] >= RANK[from];
}

/**
 * Start photo: the driver uploads it to `partnership-start-photos/{partnershipId}/{uid}/…` and the start command carries
 * the download URL. Only that exact path (own uid, this partnership) is accepted.
 */
export function verifyStartPhotoUrl(url: unknown, partnershipId: string, uid: string): string {
  const value = text(url);
  let parsed: URL;
  try { parsed = new URL(value); } catch { return ""; }
  if (parsed.protocol !== "https:") return "";
  const prefix = `${PARTNERSHIP_PHOTO_PREFIX}/${partnershipId}/${uid}/`;
  let objectPath = "";
  if (parsed.hostname === "firebasestorage.googleapis.com") {
    const match = parsed.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
    if (match) { try { objectPath = decodeURIComponent(match[1]); } catch { return ""; } }
  } else if (parsed.hostname === "storage.googleapis.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    try { objectPath = decodeURIComponent(segments.slice(1).join("/")); } catch { return ""; }
  }
  if (!objectPath.startsWith(prefix) || objectPath.length <= prefix.length || objectPath.includes("..")) return "";
  return value.length <= 2500 ? value : "";
}

export type LedgerEntry = { n: number; at: number; cents: number; tripId: string };
export type Ledger = { progress: number; earningsCents: number; bestCents: number; averageCents: number; entries: LedgerEntry[] };
const ms = (value: any): number => value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value === "number" ? value : Date.parse(String(value || "")));
const centsOf = (trip: Record<string, any>): number => {
  if (Number.isSafeInteger(trip.valorCents)) return Math.max(0, trip.valorCents);
  const value = Number(trip.valor);
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0;
};
/** Each confirmed trip counts exactly once (deduplicated by trip id), in confirmation order. */
export function buildLedger(rows: { id: string; data: Record<string, any> }[], scope: CanonicalConfirmationScope): Ledger {
  const seen = new Set<string>();
  const trips = rows.filter(row => !seen.has(row.id) && (seen.add(row.id), isCanonicalConfirmedTrip(row.data, scope)))
    .map(row => ({ id: row.id, at: ms(row.data.completedAt) || ms(row.data.createdAt) || ms(row.data.dataLancamento) || 0, cents: centsOf(row.data) }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const entries = trips.slice(0, MAX_LEDGER).map((trip, index) => ({ n: index + 1, at: trip.at, cents: trip.cents, tripId: trip.id }));
  const earningsCents = entries.reduce((sum, entry) => sum + entry.cents, 0);
  return { progress: entries.length, earningsCents, bestCents: entries.reduce((best, entry) => Math.max(best, entry.cents), 0),
    averageCents: entries.length ? Math.round(earningsCents / entries.length) : 0, entries };
}

/** Fields the job and every trip of a partnership carry, so ranking and projections can find them. */
export function partnershipTripFields(job: Record<string, any>): Record<string, string> {
  const partnershipId = text(job.partnershipId), scoreCompanyId = text(job.scoreCompanyId);
  return partnershipId && scoreCompanyId ? { partnershipId, scoreCompanyId, contractorCompanyId: text(job.contractorCompanyId) || scoreCompanyId } : {};
}

/** Atraso na entrega: o valor final do acordo cai 25% (calculado pelo app e informado às duas empresas). */
export const LATE_PENALTY_PERCENT = 25;
export type Settlement = { agreedCents: number; late: boolean; penaltyPercent: number; discountCents: number; finalCents: number; deadlineMs: number; completedAtMs: number };
/** Valor final do acordo: concluída depois do prazo = valor combinado menos 25%. Sem valor combinado não há liquidação. */
export function computeSettlement(agreedCents: number | null | undefined, deadlineMs: number, completedAtMs: number): Settlement | null {
  if (!Number.isSafeInteger(agreedCents) || (agreedCents as number) < 1) return null;
  const agreed = agreedCents as number, late = Number.isFinite(deadlineMs) && deadlineMs > 0 && completedAtMs > deadlineMs;
  const finalCents = late ? Math.round(agreed * (100 - LATE_PENALTY_PERCENT) / 100) : agreed;
  return { agreedCents: agreed, late, penaltyPercent: late ? LATE_PENALTY_PERCENT : 0, discountCents: agreed - finalCents, finalCents, deadlineMs: deadlineMs || 0, completedAtMs };
}
export type PaymentStatus = "pending" | "paid" | "settled";
/** Quem pode dar o próximo passo da liquidação: a contratante marca "pago"; a executora confirma "recebido". */
export function nextPayment(current: PaymentStatus, action: "paid" | "received"): PaymentStatus | null {
  if (action === "paid") return current === "pending" ? "paid" : null;
  return current === "pending" || current === "paid" ? "settled" : null;
}
export const PIX_TYPES = ["cpf", "cnpj", "phone", "email", "random"] as const;
export type PixType = typeof PIX_TYPES[number];
/** Chave Pix do recebedor, validada pelo formato (o NVU não move dinheiro: só mostra a chave à pagadora). Telefone vira +55DDDNÚMERO. */
export function normalizePixKey(type: unknown, key: unknown): { type: PixType; key: string } {
  const kind = String(type || "").trim().toLowerCase() as PixType, raw = String(key ?? "").trim();
  if (!PIX_TYPES.includes(kind)) throw new Error("Escolha o tipo da chave Pix.");
  const digits = raw.replace(/\D/g, "");
  if (kind === "cpf") { if (digits.length !== 11) throw new Error("O CPF da chave Pix precisa ter 11 números."); return { type: kind, key: digits }; }
  if (kind === "cnpj") { if (digits.length !== 14) throw new Error("O CNPJ da chave Pix precisa ter 14 números."); return { type: kind, key: digits }; }
  if (kind === "phone") {
    const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
    if (national.length < 10 || national.length > 11) throw new Error("O telefone da chave Pix precisa ter DDD e número.");
    return { type: kind, key: `+55${national}` };
  }
  if (kind === "email") {
    const mail = raw.toLowerCase();
    if (mail.length > 77 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) throw new Error("O e-mail da chave Pix é inválido.");
    return { type: kind, key: mail };
  }
  const random = raw.toLowerCase();
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/.test(random)) throw new Error("A chave aleatória do Pix precisa ter 32 caracteres (letras de a a f e números).");
  return { type: kind, key: random.replace(/-/g, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5") };
}
/** Instante (ms) de timestamps do Firestore, ISO ou números; 0 se não houver. */
export function toMillis(value: any): number {
  const ms = value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value === "number" ? value : Date.parse(String(value || "")));
  return Number.isFinite(ms) ? ms : 0;
}
