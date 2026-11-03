import { auth } from "../lib/firebase";
import { canonicalTripCommandService } from "../application/trip/CanonicalTripCommandService";
import { canonicalTripRepository } from "../repositories/CanonicalTripRepository";
import { isCanonicalConfirmedTrip } from "../../functions/src/isCanonicalConfirmedTrip";
import { validateScsDelivery } from "../../functions/src/scsTelemetryEvidence";
import { isWindowsDesktop, type WindowsStatus } from "../lib/windowsAutomation";

let running = false;
export async function synchronizeWindowsDeliveries(status: WindowsStatus): Promise<void> {
  if (!isWindowsDesktop() || running || !auth.currentUser) return;
  running = true;
  try {
    for (const row of status.pending) {
      const s = row.scope, uid = auth.currentUser?.uid;
      if (!uid || uid !== s.driverId || !["PENDING", "QUEUED"].includes(row.state)) continue;
      const e = validateScsDelivery(row.event);
      const tripId = `scs_${uid}_${e.simulatorKey}_${e.eventId}`;
      const local = canonicalTripRepository.get(tripId);
      if (local) {
        if (isCanonicalConfirmedTrip(local as any, { driverId: uid, companyId: s.companyId, contractId: s.contractId, operationId: s.jobId })) {
          await window.nvuWindows!.acknowledge({ id: row.id, state: "CONFIRMED", tripId, serverValidated: true });
        }
        continue;
      }
      const completedAtLocal = new Date(e.capturedAt).toISOString();
      await canonicalTripCommandService.addTripWithinOperationLimit({
        canonicalTripId: tripId, tripId, deterministicTripId: tripId, idempotencyKey: tripId,
        driverId: uid, motoristaId: uid, companyId: s.companyId, empresaId: s.companyId,
        jobId: s.jobId, contractId: s.contractId, contratoId: s.contractId,
        simulatorId: e.simulatorKey, simulatorKey: e.simulatorKey,
        simulatorCode: e.simulatorKey.toUpperCase(), simuladorCodigo: e.simulatorKey.toUpperCase(),
        origem: e.origin, destino: e.destination, valor: e.amountCents / 100, valorCents: e.amountCents,
        currency: e.currency, distanciaPercorrida: e.distanceKm, scsTelemetry: e,
        source: "PRO_WINDOWS_SCS", automationSource: "SCS_TELEMETRY_SDK_1_16",
        registroAutomatico: true, valorDetectadoAutomaticamente: true, valorDeteccaoMetodo: "scs_telemetry_revenue",
        completedAtLocal, createdAtLocal: completedAtLocal,
      }, { waitForServerAck: false });
      // Local acceptance is not a server confirmation. The shared sync supervisor owns retries.
      if (auth.currentUser?.uid === uid) await window.nvuWindows!.acknowledge({ id: row.id, state: "QUEUED", tripId,
        message: "Viagem salva. Aguardando confirmação do servidor." });
    }
  } finally { running = false; }
}
