import { collection, getDocsFromServer, query, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { canonicalTripStore } from "../../lib/CanonicalTripStore";
import { findLatestConsecutiveProDuplicate } from "../../lib/proDuplicatePolicy";
import { getTripMetricDate, normalizeTrip, parseTripValue } from "../../lib/tripNormalizer";
import { isCanonicalConfirmedTrip } from "../../../functions/src/isCanonicalConfirmedTrip";

/** Validações de duplicidade sempre usam a projeção canônica e escopo explícito. */
export class CanonicalTripDuplicateService {
  async findTripByImageHash(hash: string, companyId: string) {
    return canonicalTripStore.list().find(
      (trip: any) =>
        trip.companyId === companyId &&
        trip.imageHash === hash &&
        !trip.deleted,
    );
  }

  async findLatestOperationTripByValue(params: {
    jobId: string;
    driverId: string;
    companyId: string;
    amountCents: number;
    simulatorKey?: string;
    duplicateGuardKey?: string;
  }) {
    const uid = auth.currentUser?.uid || "";
    const jobId = String(params?.jobId || "").trim();
    const driverId = String(params?.driverId || "").trim();
    const companyId = String(params?.companyId || "").trim();
    const amountCents = Math.round(Number(params?.amountCents));
    if (!uid || uid !== driverId || !jobId || !companyId || !Number.isFinite(amountCents) || amountCents <= 0) {
      throw new Error("PRO_DUPLICATE_GUARD_SCOPE_INVALID");
    }

    // This query is constrained to the authenticated driver's own records; the
    // job/company/simulator predicates are rechecked locally before selection.
    const snapshot = await getDocsFromServer(query(
      collection(db, "historico_viagens"),
      where("driverId", "==", driverId),
      where("jobId", "==", jobId),
    ));
    const trips = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const byId = new Map<string, any>();
    [...canonicalTripStore.list(), ...trips].forEach((trip: any) => {
      const id = String(trip.tripId || trip.id || "").trim();
      if (id) byId.set(id, trip);
    });
    const candidates = Array.from(byId.values()).map((trip: any) => {
      const normalized = normalizeTrip(trip);
      return {
        id: String(trip.tripId || trip.id || ""),
        jobId: String(trip.jobId || ""),
        driverId: String(trip.driverId || trip.motoristaId || ""),
        companyId: String(trip.companyId || trip.empresaId || ""),
        simulatorKey: String(trip.simulatorKey || trip.simulatorId || ""),
        amountCents: Number.isFinite(Number(trip.valorCents))
          ? Math.round(Number(trip.valorCents))
          : Math.round(parseTripValue(trip.valor ?? trip.earnings) * 100),
        isValid: normalized.isValid && isCanonicalConfirmedTrip(trip, {
          operationId: jobId,
          driverId,
          companyId,
          contractId: String(trip.contractId || trip.contratoId || ""),
        }),
        simpleAutomation: trip.simpleAutomation === true || Boolean(trip.simpleDuplicateGuardKey),
        metricDateMs: getTripMetricDate(trip).getTime(),
        original: trip,
      };
    });
    const latest = findLatestConsecutiveProDuplicate(candidates, {
      jobId,
      driverId,
      companyId,
      amountCents,
      simulatorKey: params.simulatorKey,
    });
    return latest ? byId.get(latest.id) || null : null;
  }
}

export const canonicalTripDuplicateService =
  new CanonicalTripDuplicateService();
