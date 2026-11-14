/** Recompensas, fase 2 (cliente): pagamentos da folha, comprovante e contas simples. O servidor é quem muda os estados. */
import { offerCompleted, type RewardOffer } from "./rewards";
import { crc16 } from "./pixBrCode";

export type PaymentStatus = "pending" | "paid" | "received" | "contested" | "cancelled";
export type PaymentItem = { offerId: string; campaignId: string; campaignName: string; cents: number };
export type PaymentReceipt = { number: string; paidAtMs: number; amountCents: number; payerName: string; payeeName: string; pixType: string; pixKeyMasked: string; e2eId: string; campaigns: string[]; proof: PaymentProof | null };
export type PaymentProof = { url: string; readCents: number | null; check: "verified" | "unverified" | "override"; attachedAtMs: number };
export type RewardPayment = {
  id: string; payrollId: string; payrollAtMs: number; source: "manual" | "auto"; companyId: string; companyName: string; driverId: string; driverName: string; amountCents: number; items: PaymentItem[];
  pixType: string; pixKey: string; status: PaymentStatus; paidAtMs: number; receivedAtMs: number; contestReason: string; contestedAtMs: number; payAttempts: number; receipt: PaymentReceipt | null; createdAtMs: number;
};
const ms = (value: any): number => (value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value === "number" ? value : Date.parse(String(value || "")))) || 0;
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const STATUSES: PaymentStatus[] = ["pending", "paid", "received", "contested", "cancelled"];

/** Comprovante do banco anexado pela empresa (imagem + o valor que o app leu nela). */
export function normalizeProof(raw: unknown): PaymentProof | null {
  const proof = raw && typeof raw === "object" ? raw as Record<string, any> : null, url = proof ? text(proof.url) : "";
  if (!proof || !url) return null;
  const check = proof.check === "verified" || proof.check === "override" ? proof.check : "unverified";
  return { url, readCents: proof.readCents === null || proof.readCents === undefined ? null : num(proof.readCents), check, attachedAtMs: num(proof.attachedAtMs) };
}
export const PROOF_LABEL: Record<PaymentProof["check"], string> = { verified: "Valor conferido no comprovante", unverified: "Comprovante anexado (valor não lido)", override: "Valor diferente, confirmado pela empresa" };
export function normalizePayment(id: string, raw: Record<string, any>): RewardPayment {
  const receipt = raw.receipt && typeof raw.receipt === "object" ? raw.receipt as Record<string, any> : null;
  return { id, payrollId: text(raw.payrollId), payrollAtMs: num(raw.payrollAtMs), source: raw.source === "auto" ? "auto" : "manual", companyId: text(raw.companyId), companyName: text(raw.companyName) || "Empresa", driverId: text(raw.driverId),
    driverName: text(raw.driverName) || "Motorista", amountCents: num(raw.amountCents),
    items: (Array.isArray(raw.items) ? raw.items : []).map((item: Record<string, any>) => ({ offerId: text(item.offerId), campaignId: text(item.campaignId), campaignName: text(item.campaignName) || "Campanha", cents: num(item.cents) })),
    pixType: text(raw.pixType), pixKey: text(raw.pixKey), status: STATUSES.find(item => item === raw.status) || "pending", paidAtMs: num(raw.paidAtMs), receivedAtMs: num(raw.receivedAtMs), contestReason: text(raw.contestReason), contestedAtMs: num(raw.contestedAtMs),
    payAttempts: num(raw.payAttempts), createdAtMs: ms(raw.createdAt),
    receipt: receipt ? { number: text(receipt.number), paidAtMs: num(receipt.paidAtMs), amountCents: num(receipt.amountCents), payerName: text(receipt.payerName), payeeName: text(receipt.payeeName), pixType: text(receipt.pixType), pixKeyMasked: text(receipt.pixKeyMasked), e2eId: text(receipt.e2eId),
      campaigns: (Array.isArray(receipt.campaigns) ? receipt.campaigns : []).map(text).filter(Boolean), proof: normalizeProof(receipt.proof) } : null };
}

/** Rótulos vistos pela empresa e pelo motorista (o mesmo pagamento, duas leituras). */
export const COMPANY_PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: "A pagar", paid: "Pago", received: "Recebido", contested: "Contestado", cancelled: "Cancelado" };
export const DRIVER_PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: "Aguardando pagamento", paid: "Confirmar recebimento", received: "Recebido", contested: "Contestado", cancelled: "Cancelado" };
export const PAYMENT_TONE: Record<PaymentStatus, string> = { pending: "warn", paid: "good", received: "good", contested: "late", cancelled: "muted" };
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * Saldo por motorista. Só quem concluiu a operação (alcançou a meta) entra na próxima folha (`rows`); quem ainda não concluiu
 * fica em `waiting` e recebe na folha da semana em que concluir (na próxima, se não der nesta).
 */
export function pendingBalance(offers: RewardOffer[]) {
  const ready = new Map<string, { driverId: string; driverName: string; cents: number }>(), waiting: { id: string; driverId: string; driverName: string; trips: number; of: number; cents: number }[] = [];
  for (const offer of offers) {
    if (offer.status !== "accepted") continue;
    const cents = Math.max(0, (Number(offer.totalCents) || 0) - (Number(offer.settledCents) || 0));
    if (cents <= 0) continue;
    if (!offerCompleted(offer)) { waiting.push({ id: offer.id, driverId: offer.driverId, driverName: offer.driverName, trips: offer.trips, of: offer.maxTripsPerDriver, cents }); continue; }
    const row = ready.get(offer.driverId) || { driverId: offer.driverId, driverName: offer.driverName, cents: 0 };
    row.cents += cents; ready.set(offer.driverId, row);
  }
  const rows = [...ready.values()].sort((a, b) => b.cents - a.cents || a.driverName.localeCompare(b.driverName));
  return { rows, totalCents: rows.reduce((sum, row) => sum + row.cents, 0), waiting: waiting.sort((a, b) => a.driverName.localeCompare(b.driverName)) };
}
/** "10/11/2026 às 14:32" em horário de Brasília, igual em qualquer aparelho. */
export const dateTimeText = (value: number): string => {
  if (!value) return "—";
  const iso = new Date(value - 3 * 3_600_000).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} às ${iso.slice(11, 16)}`;
};
/** Próxima data (dia/mês) em que cai o dia de pagamento escolhido, a partir de hoje (hoje conta). */
export const nextPayDayText = (payDay: number, now: number): string => {
  const today = new Date(now - 3 * 3_600_000).getUTCDay(), ahead = (payDay - today + 7) % 7, iso = new Date(now - 3 * 3_600_000 + ahead * 86_400_000).toISOString();
  return ahead === 0 ? "hoje" : `${WEEKDAYS[payDay].toLowerCase()}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};
/** Só para o teste de paridade com o servidor (mesmo número de comprovante). */
export const checksum = crc16;
/** Chave Pix para leitura humana (a chave guardada e copiada continua sem máscara). */
export function formatPixKey(type: string, key: string): string {
  const digits = key.replace(/\D/g, "");
  if (type === "cpf" && digits.length === 11) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  if (type === "cnpj" && digits.length === 14) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  if (type === "phone" && key.startsWith("+55") && (digits.length === 12 || digits.length === 13)) { const n = digits.slice(2); return `+55 (${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}`; }
  return key;
}
