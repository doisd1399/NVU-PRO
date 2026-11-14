/**
 * O veículo de uma viagem é o que a empresa determinou para a operação (o que entrou junto com ela), nunca o caminhão que o jogador
 * usa no jogo: a telemetria do Windows não informa veículo. Estas funções leem esse veículo da operação (e da frota, pelo identificador).
 */
type Row = Record<string, any>;
export type OperationVehicle = { id: string; name: string; plate: string };

const text = (value: unknown): string => String(value ?? "").trim();
const blank = (value: unknown): boolean => { const v = text(value); return !v || v === "-"; };

export function operationVehicleOf(jobId: string | null | undefined, jobs: readonly Row[], vehicles: readonly Row[]): OperationVehicle | null {
  const id = text(jobId);
  const job = id ? jobs.find(row => text(row.id) === id) : undefined;
  if (!job) return null;
  const vehicleId = text(job.vehicleId || job.veiculoId);
  const vehicle = vehicleId ? vehicles.find(row => text(row.id) === vehicleId) : undefined;
  const name = text(job.vehicleName || job.veiculoNome || vehicle?.name || vehicle?.nome);
  if (!name) return null;
  return { id: vehicleId, name, plate: text(job.vehiclePlate || job.veiculoPlaca || vehicle?.plate || vehicle?.placa) };
}

/** Viagem sem nome de veículo (ex.: registrada antes desta correção) mostra o veículo determinado pela operação. */
export function withOperationVehicle<T extends Row>(trip: T, jobs: readonly Row[], vehicles: readonly Row[]): T {
  if (!blank(trip.veiculoNome)) return trip;
  const found = operationVehicleOf(trip.jobId || trip.operationId || trip.trabalhoId, jobs, vehicles);
  if (!found) return trip;
  return { ...trip, veiculoNome: found.name, ...(blank(trip.veiculoPlaca) && found.plate ? { veiculoPlaca: found.plate } : {}), ...(blank(trip.veiculoId) && found.id ? { veiculoId: found.id } : {}) };
}
