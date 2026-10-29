/** Callable-safe copy of the exact server-owned row committed by the transaction. */
export function canonicalTripAck(value: any): any {
  if (value == null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalTripAck);
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)
    .map(([key, child]) => [key, canonicalTripAck(child)]));
}
