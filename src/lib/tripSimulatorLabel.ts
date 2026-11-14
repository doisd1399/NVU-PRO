import { resolveProSimulatorCode } from "../services/pro-universal/proUniversalContracts";
import { formatSimulatorLabel } from "./simulatorOptions";

/** Simulator text of a trip row/card: OCR registry code, else a human label; an internal identifier is never shown. */
export function displayTripSimulatorName(trip: Record<string, any>): string {
  const canonicalCode = resolveProSimulatorCode(
    trip.simulatorCode
      || trip.simuladorCodigo
      || trip.simulatorKey
      || trip.simulatorId
      || trip.simuladorNome
      || trip.simulatorName,
  );
  if (canonicalCode) return canonicalCode;
  // ETS2/ATS and any other game outside the OCR registry: human label from the shared resolver; internal IDs are never shown.
  for (const candidate of [trip.simulatorCode, trip.simuladorCodigo, trip.simulatorKey, trip.simuladorNome, trip.simulatorName, trip.simulatorId]) {
    const label = formatSimulatorLabel(candidate);
    if (label) return label;
  }
  return "-";
}
