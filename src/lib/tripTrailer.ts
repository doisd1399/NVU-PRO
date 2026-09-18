import { isTrailerlessSimulator } from "./resolveSimulator";

export type TripTrailerResolution = {
  reboqueId: string;
  reboqueNome: string;
};

export function resolveTripTrailerFields(input: {
  simulatorKey?: unknown;
  job?: any;
  contract?: any;
  trailer?: any;
}): TripTrailerResolution {
  if (isTrailerlessSimulator(input.simulatorKey)) {
    return { reboqueId: "", reboqueNome: "" };
  }
  const reboqueId = String(
    input.trailer?.id || input.job?.trailerId || input.contract?.trailerId || "",
  ).trim();
  const reboqueNome = String(
    input.trailer?.name
      || input.trailer?.nome
      || input.job?.trailerName
      || input.job?.reboqueNome
      || input.contract?.trailerName
      || input.contract?.reboqueNome
      || "",
  ).trim();
  return { reboqueId, reboqueNome };
}

export function resolveTripTrailerName(input: {
  trip?: Record<string, any> | null;
  trailers?: any[];
  jobs?: any[];
  contracts?: any[];
}): string {
  const trip = input.trip;
  if (!trip) return "";

  const directName = String(
    trip.reboqueNome
      || trip.trailerName
      || trip.reboque_nome
      || "",
  ).trim();
  if (directName) return directName;

  const directId = String(
    trip.reboqueId
      || trip.trailerId
      || trip.reboque_id
      || trip.trailer_id
      || "",
  ).trim();
  const jobId = String(trip.jobId || trip.trabalhoId || "").trim();
  const contractId = String(
    trip.contratoId
      || trip.contractId
      || trip.contract_id
      || "",
  ).trim();
  const job = jobId
    ? (input.jobs || []).find((candidate) => String(candidate?.id || "") === jobId)
    : undefined;
  const jobContractId = String(job?.contractId || job?.contratoId || "").trim();
  const tripContractLabel = String(
    trip.contratoNumero
      || trip.contractNumber
      || trip.contractName
      || "",
  ).trim().toLocaleLowerCase();
  const contract = (input.contracts || []).find((candidate) => {
    const candidateId = String(candidate?.id || "").trim();
    if (contractId || jobContractId) {
      return candidateId === (contractId || jobContractId);
    }
    if (!tripContractLabel) return false;
    return [candidate?.name, candidate?.numero, candidate?.contractNumber]
      .map((value) => String(value || "").trim().toLocaleLowerCase())
      .includes(tripContractLabel);
  });
  const resolvedId = String(
    directId
      || job?.trailerId
      || job?.trailer_id
      || contract?.trailerId
      || contract?.trailer_id
      || "",
  ).trim();
  const resolvedName = String(
    job?.trailerName
      || job?.reboqueNome
      || contract?.trailerName
      || contract?.reboqueNome
      || "",
  ).trim();
  if (resolvedName) return resolvedName;
  if (!resolvedId) return "";
  const trailer = (input.trailers || []).find(
    (candidate) => String(candidate?.id || "") === resolvedId,
  );
  return String(trailer?.name || trailer?.nome || "").trim();
}
