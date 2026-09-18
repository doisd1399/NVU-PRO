import { normalizeTrip } from "./tripNormalizer";

export interface TripOperationCounter {
  current: number;
  total: number;
  label: string;
}

export interface TripSequenceOptions {
  singleSequence?: boolean;
  plannedTotal?: number;
  plannedTotalsByJobId?: ReadonlyMap<string, number>;
}

function resolveTripJobId(trip: any): string {
  return String(
    trip?.jobId || trip?.trabalhoId || trip?.job_id || "",
  ).trim();
}

function resolveTripContractId(trip: any): string {
  return String(
    trip?.contratoId ||
      trip?.contractId ||
      trip?.contrato_id ||
      trip?.contratoNumero ||
      "",
  ).trim();
}

function resolveTripDriverId(trip: any): string {
  return String(
    trip?.motoristaId ||
      trip?.driverId ||
      trip?.motorista_id ||
      trip?.userId ||
      trip?.motoristaNome ||
      "",
  ).trim();
}

function getSequenceKey(trip: any, singleSequence = false): string {
  if (singleSequence) return "__embedded_job__";

  const jobId = resolveTripJobId(trip);
  if (jobId) return `job:${jobId}`;

  const contractId = resolveTripContractId(trip);
  const driverId = resolveTripDriverId(trip);
  if (contractId || driverId) return `legacy:${contractId}:${driverId}`;

  return `trip:${String(trip?.id || "")}`;
}

function getOrderedValidTrips(trips: any[]) {
  return trips
    .map((trip) => normalizeTrip(trip as any))
    .filter((trip) => trip.isValid)
    .sort((a, b) => {
      const dateDiff = a.metricDate.getTime() - b.metricDate.getTime();
      if (dateDiff !== 0) return dateDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
}

/**
 * Builds the canonical trip number shown in the period counter. Numbers are
 * based on completion order (oldest = 1) and do not depend on card pagination.
 */
export function buildTripNumberMap(
  trips: any[],
  options: { singleSequence?: boolean } = {},
): Map<string, number> {
  const counters = new Map<string, number>();
  const numberByTripId = new Map<string, number>();

  getOrderedValidTrips(trips).forEach((trip) => {
    const sequenceKey = getSequenceKey(trip, options.singleSequence);
    const nextNumber = (counters.get(sequenceKey) || 0) + 1;
    counters.set(sequenceKey, nextNumber);
    numberByTripId.set(String(trip.id), nextNumber);
  });

  return numberByTripId;
}

/**
 * Builds the `current/total` counter for each operation.
 *
 * `current` is always the chronological execution order inside that job.
 * `total` prioritizes the operation's configured delivery target. This avoids
 * displaying `1/1` after the first completed trip when the operation actually
 * requires, for example, 12 trips. The number of existing valid trips is kept
 * as a safety floor for legacy or inconsistent data.
 */
export function buildTripOperationCounterMap(
  trips: any[],
  options: TripSequenceOptions = {},
): Map<string, TripOperationCounter> {
  const groups = new Map<string, ReturnType<typeof getOrderedValidTrips>>();

  getOrderedValidTrips(trips).forEach((trip) => {
    const key = getSequenceKey(trip, options.singleSequence);
    const group = groups.get(key) || [];
    group.push(trip);
    groups.set(key, group);
  });

  const result = new Map<string, TripOperationCounter>();

  groups.forEach((group) => {
    const firstTrip = group[0];
    const jobId = resolveTripJobId(firstTrip);
    const configuredTotal = options.singleSequence
      ? Number(options.plannedTotal || 0)
      : Number(options.plannedTotalsByJobId?.get(jobId) || 0);
    const total = Math.max(group.length, configuredTotal);

    group.forEach((trip, index) => {
      const current = index + 1;
      result.set(String(trip.id), {
        current,
        total,
        label: `${current}/${total}`,
      });
    });
  });

  return result;
}
