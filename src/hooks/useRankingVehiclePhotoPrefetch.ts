import { useEffect, useRef, useState } from "react";
import { resolveVehiclePhotoOperationSimulatorId } from "../lib/vehiclePhotoIdentity";
import { operationAssignmentTimestamp } from "../lib/currentOperation";
import { vehiclePhotoService } from "../services/vehiclePhotoService";
import { clearVehiclePhotoIdentitySnapshot, writeVehiclePhotoIdentitySnapshot } from "../services/vehiclePhotoIdentitySnapshot";
import { readRankingParticipantVehicle, type ParticipantVehicleContext } from "./useRankingParticipantVehicle";

/** Warm the loaded ranking in the background, two participants at a time.
 * Persist bytes and the same scoped identity used by the modal before offline use.
 */
export function useRankingVehiclePhotoPrefetch(
  participants: { id: string; companyId?: string }[],
  context: ParticipantVehicleContext,
  enabled: boolean,
) {
  const latest = useRef(context); latest.current = context;
  const [onlineEpoch, setOnlineEpoch] = useState(0);
  const warmed = useRef(new Map<string, number>());
  const signature = JSON.stringify(participants.map((item) => [item.id, item.companyId || ""]));
  useEffect(() => {
    const onOnline = () => { warmed.current.clear(); setOnlineEpoch((value) => value + 1); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  useEffect(() => {
    if (!enabled || !context.viewerId || navigator.onLine === false) return;
    let cancelled = false, cursor = 0;
    const scope = latest.current;
    const worker = async () => {
      while (!cancelled && cursor < participants.length && navigator.onLine !== false) {
        const participant = participants[cursor++];
        const key = JSON.stringify([participant.id, participant.companyId, scope.viewerId, scope.simulatorId]);
        if ((warmed.current.get(key) || 0) > Date.now()) continue;
        try {
          const result = await readRankingParticipantVehicle(participant.id, participant.companyId || "", scope);
          if (cancelled) return;
          if (!result.operation) {
            if (result.authoritative) clearVehiclePhotoIdentitySnapshot(participant.id, participant.companyId || "", scope);
            continue;
          }
          const job = result.operation;
          const companies = scope.companies || [], simulators = scope.simulators || [];
          const company = companies.find((item) => item.id === (job.companyId || job.empresaId || participant.companyId));
          const simulatorId = resolveVehiclePhotoOperationSimulatorId(
            job, company, scope.simulatorId, simulators, companies, [result.vehicle],
          );
          const vehicleId = String(job.vehicleId || job.veiculoId || "").trim();
          if (!simulatorId || !vehicleId) continue;
          const identity = { userId: participant.id, simulatorId, vehicleId, vehicleName: String(job.vehicleName || result.vehicle?.name || "Veículo atual") };
          writeVehiclePhotoIdentitySnapshot({ ...identity, companyId: participant.companyId || "all", operationCompanyId: String(job.companyId || job.empresaId || ""), companyName: String(company?.name || company?.companyName || ""), companyLogo: String(company?.logoUrl || company?.logoURL || company?.companyLogoURL || ""), operationId: job.id, evidenceAt: operationAssignmentTimestamp(job), source: "last-used" }, scope);
          const record = await vehiclePhotoService.load(identity, participant.companyId || "");
          if (record) {
            if (warmed.current.size >= 512) warmed.current.delete(warmed.current.keys().next().value!);
            warmed.current.set(key, Date.now() + 60_000);
          }
        } catch { /* Keep the modal available; failed rows retry on reconnection. */ }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const timer = setTimeout(() => { void worker(); void worker(); }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [signature, context.viewerId, context.simulatorId, enabled, onlineEpoch, context.companies?.length, context.simulators?.length]);
}
