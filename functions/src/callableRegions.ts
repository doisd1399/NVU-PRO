/**
 * Regions that serve the interactive callables.
 *
 * Firestore for this project lives in `southamerica-east1` (São Paulo). A callable running in `us-central1` pays a
 * cross-continent round trip (~130–200 ms) on every Firestore read of its transaction, plus a slower TLS/preflight
 * leg from the user's phone. Serving the same callable from São Paulo removes both.
 *
 * `us-central1` stays in the list on purpose: installed apps that still call that region keep working, and the
 * client falls back to it when the São Paulo copy is not available yet. Both copies run exactly the same code and
 * write to the same database, so a call is never "split" between regions.
 *
 * Firestore *triggers* are not listed here: a trigger deployed in two regions would process every event twice.
 * They stay where they are (they run in the background, off the user's critical path).
 */
export const CALLABLE_REGIONS = ["southamerica-east1", "us-central1"] as const;

/** A request sent only to wake an idle instance. It must be answered before any authorization or database work. */
export const isWarmPing = (input: unknown): boolean =>
  !!input && typeof input === "object" && !Array.isArray(input) && (input as Record<string, unknown>).__warm === true;
