import { fail, text } from "./operationalCommandPolicy";

/**
 * Comprovante de pagamento (Pix): a empresa anexa a imagem do banco e o app tenta ler o valor nela.
 * A leitura é feita no aparelho (OCR); o servidor confere se o valor lido é o do pagamento e guarda o resultado junto do arquivo.
 * Resultado: "verified" (valor igual), "unverified" (o app não conseguiu ler o valor) ou "override" (valor diferente, confirmado pela empresa).
 */
export type ProofCheck = "verified" | "unverified" | "override";
export type PaymentProof = { url: string; readCents: number | null; check: ProofCheck; attachedAtMs: number };

export const REWARD_RECEIPT_PREFIX = "reward-receipts";
export const PARTNERSHIP_RECEIPT_PREFIX = "partnership-receipts";

const money = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Só aceita o endereço do Storage dentro de `prefix/{refId}/{uid}/…` (o próprio usuário, este pagamento). */
export function verifyProofUrl(url: unknown, prefix: string, refId: string, uid: string): string {
  const value = text(url);
  let parsed: URL;
  try { parsed = new URL(value); } catch { return ""; }
  if (parsed.protocol !== "https:") return "";
  const expected = `${prefix}/${refId}/${uid}/`;
  let objectPath = "";
  if (parsed.hostname === "firebasestorage.googleapis.com") {
    const match = parsed.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
    if (match) { try { objectPath = decodeURIComponent(match[1]); } catch { return ""; } }
  } else if (parsed.hostname === "storage.googleapis.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    try { objectPath = decodeURIComponent(segments.slice(1).join("/")); } catch { return ""; }
  }
  if (!objectPath.startsWith(expected) || objectPath.length <= expected.length || objectPath.includes("..")) return "";
  return value.length <= 2500 ? value : "";
}

/** Confere o comprovante enviado com o valor do pagamento. Sem comprovante válido, não há como marcar como pago. */
export function normalizeProof(raw: unknown, expectedCents: number, prefix: string, refId: string, uid: string, nowMs: number): PaymentProof {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const url = verifyProofUrl(data.url, prefix, refId, uid);
  if (!url) fail("invalid-argument", "Anexe o comprovante do pagamento (imagem do banco) para marcar como pago.");
  const read = data.readCents === null || data.readCents === undefined ? null : Number(data.readCents);
  if (read !== null && (!Number.isSafeInteger(read) || read < 0 || read > 100_000_000_000)) fail("invalid-argument", "O valor lido no comprovante é inválido.");
  if (read === null) return { url, readCents: null, check: "unverified", attachedAtMs: nowMs };
  if (read === expectedCents) return { url, readCents: read, check: "verified", attachedAtMs: nowMs };
  if (data.override === true) return { url, readCents: read, check: "override", attachedAtMs: nowMs };
  return fail("failed-precondition", `O valor do comprovante (${money(read)}) é diferente do valor do pagamento (${money(expectedCents)}). Confira o comprovante.`);
}
