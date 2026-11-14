export type RankingEligibilityReason =
  | 'ELIGIBLE'
  | 'NOT_COMPLETED'
  | 'SYNC_PENDING'
  | 'DELETED'
  | 'MISSING_IDENTITY';

export type RankingEligibilityResult = {
  eligible: boolean;
  reason: RankingEligibilityReason;
};

/**
 * Fonte única para decidir se uma viagem pode participar dos agregados.
 * Histórico pode conter registros antes desta etapa, mas ranking/métricas
 * devem consumir apenas viagens elegíveis.
 */
export function evaluateRankingEligibility(trip: {
  status?: string;
  deleted?: boolean;
  canonicalTripId?: string;
  tripId?: string;
}): RankingEligibilityResult {
  if (trip.deleted) {
    return { eligible: false, reason: 'DELETED' };
  }

  if (!trip.canonicalTripId && !trip.tripId) {
    return { eligible: false, reason: 'MISSING_IDENTITY' };
  }

  if (trip.status && !['SERVER_CONFIRMED', 'HISTORY_CONFIRMED'].includes(trip.status)) {
    return { eligible: false, reason: 'SYNC_PENDING' };
  }

  return { eligible: true, reason: 'ELIGIBLE' };
}
