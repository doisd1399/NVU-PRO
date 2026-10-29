import { evaluateRankingEligibility } from '../../lib/rankingEligibilityService';

export class CanonicalTripConsistencyService {
  validate(trip: any) {
    const canonicalTripId = trip.canonicalTripId || trip.tripId || trip.idempotencyKey || trip.clientRequestId;
    const eligibility = evaluateRankingEligibility({
      status: trip.status,
      deleted: trip.deleted,
      canonicalTripId,
      tripId: trip.tripId,
    });

    return {
      ...trip,
      canonicalTripId,
      rankingEligible: eligibility.eligible,
      rankingEligibilityReason: eligibility.reason,
    };
  }
}

export const canonicalTripConsistencyService = new CanonicalTripConsistencyService();
