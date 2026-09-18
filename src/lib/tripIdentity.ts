function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return undefined;
}

/**
 * Canonical identity readers shared by Trip History, profiles and ranking.
 * Historical documents exist with multiple field names, so every screen must
 * resolve the same aliases or the visible history and the performance totals
 * diverge for the same driver and period.
 */
export function getCanonicalTripDriverId(trip: any): string | undefined {
  return firstNonEmpty(
    trip?.motoristaId,
    trip?.driverId,
    trip?.motorista_id,
    trip?.userId,
    trip?.driver_id,
  );
}

export function getCanonicalTripCompanyId(trip: any): string | undefined {
  return firstNonEmpty(
    trip?.empresaId,
    trip?.companyId,
    trip?.company_id,
    trip?.empresa_id,
  );
}

export function getCanonicalTripDriverName(trip: any): string | undefined {
  return firstNonEmpty(
    trip?.motoristaNome,
    trip?.driverName,
    trip?.motorista_nome,
    trip?.nomeMotorista,
    trip?.driver_name,
  );
}
