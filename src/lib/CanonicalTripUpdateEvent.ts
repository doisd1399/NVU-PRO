import type { CanonicalTrip } from "../domain/trip/CanonicalTrip";
import { rankingProjectionService } from "../application/ranking/RankingProjectionService";
import { clearAllTripHistoryCache } from "./tripHistoryPersistentCache";
import { invalidateRankingAggregateCaches } from "../repositories/RankingAggregateRepository";
import { clearRankingPremiumCache } from "../services/rankingPremiumCache";

export const CANONICAL_TRIP_UPDATED = "nvu:canonical-trip-updated";
let operationListenerCleanup: (() => void) | null = null;

export function emitCanonicalTripUpdated(trip: CanonicalTrip): void {
  rankingProjectionService.invalidate(trip.deleted ? "TRIP_DELETED" : "CANONICAL_TRIP_UPDATED");
  invalidateRankingAggregateCaches();
  clearRankingPremiumCache();
  if (typeof window === "undefined") return;
  registerOperationReconciliationListener();
  window.dispatchEvent(new CustomEvent(CANONICAL_TRIP_UPDATED, { detail: trip }));
  void import("../services/operationReconciliationService").then(({ reconcileOperationProjection }) => {
    reconcileOperationProjection(trip);
  });
}

export function onCanonicalTripUpdated(handler: (trip: CanonicalTrip) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<CanonicalTrip>).detail);
  window.addEventListener(CANONICAL_TRIP_UPDATED, listener);
  return () => window.removeEventListener(CANONICAL_TRIP_UPDATED, listener);
}

export function registerCanonicalTripCacheInvalidation(): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const trip = (event as CustomEvent<CanonicalTrip>).detail;
    clearAllTripHistoryCache();
    rankingProjectionService.invalidate(trip?.deleted ? "TRIP_DELETED" : "CANONICAL_TRIP_UPDATED");
    invalidateRankingAggregateCaches();
    clearRankingPremiumCache();
  };
  window.addEventListener(CANONICAL_TRIP_UPDATED, handler);
  return () => window.removeEventListener(CANONICAL_TRIP_UPDATED, handler);
}

export function registerOperationReconciliationListener(): () => void {
  if (operationListenerCleanup) return operationListenerCleanup;
  if (typeof window === "undefined") return () => {};
  let active = true;
  const handler = (event: Event) => {
    if (!active) return;
    const detail = (event as CustomEvent).detail || {};
    window.dispatchEvent(new CustomEvent("nvu:operation-projection-refresh-required", { detail }));
  };
  window.addEventListener("nvu:operation-reconciliation-required", handler);
  operationListenerCleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener("nvu:operation-reconciliation-required", handler);
    operationListenerCleanup = null;
  };
  return operationListenerCleanup;
}
