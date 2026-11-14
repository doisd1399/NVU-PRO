import assert from "node:assert/strict";
import { operationVehicleOf, withOperationVehicle } from "../src/lib/operationVehicle.ts";

const vehicles = [{ id: "v1", name: "Western Star", plate: "CE-10" }, { id: "v2", nome: "Volvo FH", placa: "AB-12" }];
const jobs = [{ id: "j1", vehicleId: "v1" }, { id: "j2", vehicleId: "v2", vehicleName: "Nome da operação", vehiclePlate: "ZZ-99" }, { id: "j3" }, { id: "j4", vehicleId: "ausente" }];

// o veículo é o da operação: nome gravado nela, ou o da frota pelo identificador
assert.deepEqual(operationVehicleOf("j1", jobs, vehicles), { id: "v1", name: "Western Star", plate: "CE-10" });
assert.deepEqual(operationVehicleOf("j2", jobs, vehicles), { id: "v2", name: "Nome da operação", plate: "ZZ-99" }, "o que está na operação vale mais que a frota");
assert.equal(operationVehicleOf("j3", jobs, vehicles), null); assert.equal(operationVehicleOf("j4", jobs, vehicles), null);
assert.equal(operationVehicleOf("nao-existe", jobs, vehicles), null); assert.equal(operationVehicleOf("", jobs, vehicles), null); assert.equal(operationVehicleOf(undefined, jobs, vehicles), null);

// viagem do Windows sem veículo (o "-" do histórico) passa a mostrar o da operação, por qualquer um dos campos de operação
for (const field of ["jobId", "operationId", "trabalhoId"]) {
  const shown = withOperationVehicle({ id: "t", [field]: "j1", veiculoNome: "-" }, jobs, vehicles);
  assert.deepEqual([shown.veiculoNome, shown.veiculoPlaca, shown.veiculoId], ["Western Star", "CE-10", "v1"], field);
}
assert.equal(withOperationVehicle({ jobId: "j1" }, jobs, vehicles).veiculoNome, "Western Star");
assert.equal(withOperationVehicle({ jobId: "j1", veiculoNome: "   " }, jobs, vehicles).veiculoNome, "Western Star");
// nunca troca um nome já gravado, nem inventa quando a operação não tem veículo
const kept = { jobId: "j1", veiculoNome: "Outro caminhão", veiculoPlaca: "XX-00" };
assert.equal(withOperationVehicle(kept, jobs, vehicles), kept);
const none = { jobId: "j3", veiculoNome: "-" }; assert.equal(withOperationVehicle(none, jobs, vehicles), none);
const orphan = { jobId: "fora", veiculoNome: "" }; assert.equal(withOperationVehicle(orphan, jobs, vehicles), orphan);
assert.equal(withOperationVehicle({ jobId: "j1", veiculoNome: "", veiculoPlaca: "KEEP" }, jobs, vehicles).veiculoPlaca, "KEEP");
console.log("OPERATION_VEHICLE_PASS veículo da operação (não o do jogo) no histórico e na viagem enviada");
