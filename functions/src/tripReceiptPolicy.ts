import { createHash } from "node:crypto";

export function isSupportedReceiptCurrency(value: unknown): boolean {
  return typeof value === "string" && ["BRL", "EUR", "USD"].includes(value.toUpperCase());
}

export { readReceiptAmountCents } from "./receiptAmount";
import { readReceiptAmountCents } from "./receiptAmount";

export function readSimpleReceiptAmountCents(simulator: string, raw: string): number | null {
  const normalized = raw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const labels = ["gto", "global-truck", "global-truck-online"].includes(simulator) ? "VALOR\\s+A\\s+RECEBER"
    : ["toe3", "toe-3", "truckers-of-europe-3"].includes(simulator) ? "RENDA\\s+TOTAL|GANHOS"
    : ["wtds", "wbds"].includes(simulator) ? "GANHOS\\s+DA\\s+VIAGEM|TOTAL" : null;
  if (!labels) return null;
  const matches = [...normalized.matchAll(new RegExp(`(?:${labels})[^0-9]{0,140}([0-9][0-9.,]*)`, "g"))];
  const amounts = matches.map((match) => readReceiptAmountCents(match[1]));
  return amounts.length && amounts.every((amount) => amount !== null && amount > 0 && amount === amounts[0]) ? amounts[0] : null;
}

export type ReceiptCurrencyEvidence = {
  status: "known" | "unknown" | "conflict";
  currency?: "BRL" | "EUR" | "USD";
  source: "server_receipt_text_explicit" | "server_receipt_text_unverified" | "server_receipt_text_conflict";
};

/** Reads only explicit currency tokens adjacent to the simulator's payout amount. The simulator itself is never a currency source. */
export function readSimpleReceiptCurrency(simulator: string, raw: string): ReceiptCurrencyEvidence {
  const normalized = raw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const labels = ["gto", "global-truck", "global-truck-online"].includes(simulator.toLowerCase()) ? ["VALOR A RECEBER"]
    : ["toe3", "toe-3", "truckers-of-europe-3"].includes(simulator.toLowerCase()) ? ["RENDA TOTAL", "GANHOS"]
    : ["wtds", "wbds"].includes(simulator.toLowerCase()) ? ["GANHOS DA VIAGEM", "TOTAL"] : [];
  const currencies = new Set<string>();
  const unsupportedCurrencies = new Set<string>();
  let ambiguousOrUnsupported = false;
  for (const label of labels) {
    let from = normalized.indexOf(label);
    while (from >= 0) {
      const tail = normalized.slice(from + label.length, from + label.length + 160);
      const tokenPattern = /R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$/;
      const money = /(?:R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$)\s*[0-9][0-9.,]*|[0-9][0-9.,]*\s*(?:R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$)/g;
      for (const match of tail.matchAll(money)) {
        const token = match[0].match(tokenPattern)?.[0]?.replace(/\s/g, "");
        if (token === "R$" || token === "BRL") currencies.add("BRL");
        else if (token === "€" || token === "EUR") currencies.add("EUR");
        else if (token === "US$" || token === "USD") currencies.add("USD");
        else if (token === "$") ambiguousOrUnsupported = true;
        else if (token) unsupportedCurrencies.add(token);
      }
      from = normalized.indexOf(label, from + 1);
    }
  }
  if (currencies.size > 1 || (unsupportedCurrencies.size > 0 && (currencies.size > 0 || unsupportedCurrencies.size > 1)))
    return { status: "conflict", source: "server_receipt_text_conflict" };
  if (ambiguousOrUnsupported || unsupportedCurrencies.size > 0 || currencies.size !== 1)
    return { status: "unknown", source: "server_receipt_text_unverified" };
  return { status: "known", currency: [...currencies][0] as "BRL" | "EUR" | "USD", source: "server_receipt_text_explicit" };
}

export function isOperationallySuspended(user: Record<string, any>, now = Date.now()): boolean {
  return [user.operationalSuspendedUntil, user.operationalSuspension?.endsAt].some((value) => {
    const millis = value && typeof value.toMillis === "function" ? value.toMillis()
      : value instanceof Date ? value.getTime()
      : typeof value === "number" ? value : Date.parse(String(value || ""));
    return Number.isFinite(millis) && millis > now;
  });
}

/** A capture retains its identity when a retry accidentally changes attemptId. */
export function proReceiptEventKey(identity: string[], capturedAt: unknown): string | null {
  const time = typeof capturedAt === "number" ? capturedAt : Date.parse(String(capturedAt || ""));
  if (!Number.isSafeInteger(time) || time <= 0 || time > Date.now() + 300_000 || identity.some((part) => !part)) return null;
  return createHash("sha256").update(JSON.stringify([...identity, time])).digest("hex");
}

/** Both entry points use the same capture identity. The legacy values are
 * accepted only on an existing event, followed by full ledger/scope checks. */
export function proReceiptEventFingerprints(input: {
  uid: string; companyId: string; contractId: string; jobId: string; simulator: string; epoch: string;
  origin: string; destination: string; amountCents: number; currencyStatus: string; currency: string; suppliedCurrency: string;
}): string[] {
  const x = input, route = [x.origin.trim(), x.destination.trim(), x.amountCents];
  const canonical = [x.uid, x.companyId, x.contractId, x.jobId, x.simulator, x.epoch, ...route];
  const legacyNative = [x.uid, x.jobId, x.companyId, x.contractId, x.epoch, ...route];
  return [
    [...canonical, x.currencyStatus, x.currency], [...canonical, x.suppliedCurrency.toUpperCase()],
    [...legacyNative, x.currencyStatus, x.currency], [...legacyNative, x.suppliedCurrency.toUpperCase()],
  ].map(value => createHash("sha256").update(JSON.stringify(value)).digest("hex"));
}
