import { auth } from "../../lib/firebase";
import { canonicalTripRepository } from "../../repositories/CanonicalTripRepository";
import { canonicalTripRealtimeService } from "./CanonicalTripRealtimeService";
import {
  listenCanonicalTripsForScope,
  type CanonicalTripReadScope,
} from "./CanonicalTripRealtimeFirebaseAdapter";
import { getTripMetricDate } from "../../lib/tripNormalizer";
import { tripMatchesReadScope } from "../../lib/tripReadScope";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import type { TripReadCoverageHandler } from "../../lib/tripReadCoverage";

/** Single read facade for history, current operation and all ranking surfaces. */
export class CanonicalTripQueryService {
  static listCanonicalTrips(): CanonicalTrip[] {
    const byPhysicalId = new Map<string, CanonicalTrip>();
    canonicalTripRepository.list().forEach((trip) => {
      const physicalId = String(
        trip.physicalDocumentId || trip.canonicalTripId || trip.tripId || "",
      ).trim();
      if (physicalId) byPhysicalId.set(physicalId, trip);
    });
    return Array.from(byPhysicalId.values());
  }

  static getTrip(id: string): CanonicalTrip | undefined {
    return canonicalTripRepository.get(id);
  }

  static subscribeRealtime(listener: (trips: CanonicalTrip[]) => void) {
    return canonicalTripRepository.subscribe(listener);
  }

  private static listenFiltered(
    predicate: (trip: CanonicalTrip) => boolean,
    onData: (trips: CanonicalTrip[]) => void,
    onError?: (error: unknown) => void,
  ) {
    try {
      return this.subscribeRealtime((trips) => onData(trips.filter(predicate)));
    } catch (error) {
      onError?.(error);
      return () => undefined;
    }
  }

  private static listenScope(
    scope: CanonicalTripReadScope,
    predicate: (trip: CanonicalTrip) => boolean,
    onData: (trips: CanonicalTrip[]) => void,
    onError?: (error: unknown) => void,
    onRemoteData?: () => void,
    onServerConfirmed?: (confirmed: boolean) => void,
    onReadCoverage?: TripReadCoverageHandler,
  ) {
    const stopRemote = listenCanonicalTripsForScope(
      scope,
      (trips) => {
        onRemoteData?.();
        onData(trips.filter(predicate));
      },
      onError,
      { readProjection: "history" },
      onServerConfirmed,
      onReadCoverage,
    );
    return () => {
      stopRemote();
    };
  }

  static listenCompanyTrips(
    companyId: string,
    onData: (trips: CanonicalTrip[]) => void,
    onError?: (error: unknown) => void,
    onReadCoverage?: TripReadCoverageHandler,
    diagnosticOwnerDriverIds: string[] = [],
  ) {
    const id = String(companyId || "").trim();
    if (!id) {
      onError?.(new Error("CANONICAL_TRIP_COMPANY_SCOPE_REQUIRED"));
      return () => undefined;
    }
    return this.listenScope(
      { companyId: id, diagnosticOwnerDriverIds },
      (trip) =>
        String(trip.companyId || (trip as any).empresaId || "").trim() === id,
      onData,
      onError,
      undefined,
      undefined,
      onReadCoverage,
    );
  }

  static listenDriverTrips(
    driverId: string,
    onData: (trips: CanonicalTrip[]) => void,
    onError?: (error: unknown) => void,
    onRemoteData?: () => void,
    onReadCoverage?: TripReadCoverageHandler,
  ) {
    const id = String(driverId || "").trim();
    if (!id) {
      onError?.(new Error("CANONICAL_TRIP_DRIVER_SCOPE_REQUIRED"));
      return () => undefined;
    }
    return this.listenScope(
      { driverId: id },
      (trip) =>
        String(trip.driverId || (trip as any).motoristaId || "").trim() === id,
      onData,
      onError,
      onRemoteData,
      undefined,
      onReadCoverage,
    );
  }

  static listenTripsByDateRange(
    startDate: Date,
    endDate: Date,
    onData: (trips: CanonicalTrip[]) => void,
    onError?: (error: unknown) => void,
    requestedScope: CanonicalTripReadScope = {},
    onServerConfirmed?: (confirmed: boolean) => void,
    onReadCoverage?: TripReadCoverageHandler,
  ) {
    const start = Math.min(startDate.getTime(), endDate.getTime());
    const end = Math.max(startDate.getTime(), endDate.getTime());
    const scope =
      requestedScope.driverId ||
      requestedScope.companyId ||
      requestedScope.companyIds?.length
        ? requestedScope
        : { driverId: auth.currentUser?.uid || "" };
    const inRange = (trip: CanonicalTrip) => {
      const date = getTripMetricDate(trip as any).getTime();
      return (
        tripMatchesReadScope(trip, scope) &&
        Number.isFinite(date) &&
        date >= start &&
        date <= end
      );
    };
    return this.listenScope(
      scope,
      inRange,
      onData,
      onError,
      undefined,
      onServerConfirmed,
      onReadCoverage,
    );
  }
}

export const canonicalTripQueryService = CanonicalTripQueryService;
