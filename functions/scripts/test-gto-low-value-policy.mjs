import assert from "node:assert/strict";
import { isInvalidLowValueGtoPrint as eligible } from "../lib/gtoLowValuePolicy.js";

const projection = {
  operationId: "job1",
  driverId: "driver1",
  companyId: "company1",
  contractId: "contract1",
  confirmedTripIds: ["trip-4"],
  confirmedTripCount: 4,
};
const row = {
  id: "trip-4",
  tripId: "trip-4",
  jobId: projection.operationId,
  driverId: projection.driverId,
  companyId: projection.companyId,
  contractId: projection.contractId,
  gtoEntryMode: "print",
  status: "concluida",
  operationSlot: 4,
  earnings: 10100,
  valor: 101,
};
assert.equal(eligible(row, projection, projection.driverId), false, "R$ 101,00 não prova erro OCR nem autoriza exclusão");
assert.equal(eligible({ ...row, valorCents: 256300 }, projection, projection.driverId), false, "representações conflitantes");
assert.equal(eligible({ ...row, valor: 1000, earnings: 100000 }, projection, projection.driverId), false, "limite de quatro dígitos");
assert.equal(eligible({ ...row, valor: 999.99, earnings: 99999 }, projection, projection.driverId), false, "qualquer valor positivo deve ser preservado");
assert.equal(eligible({ ...row, valor: "2.563,00" }, projection, projection.driverId), false, "valor textual ambíguo");
assert.equal(eligible({ ...row, operationSlot: 3 }, projection, projection.driverId), false, "slot antigo");
assert.equal(eligible({ ...row, companyId: "other" }, projection, projection.driverId), false, "empresa divergente");
assert.equal(eligible({ ...row, deleted: true }, projection, projection.driverId), false, "idempotência após exclusão");
console.log("GTO_LOW_VALUE_POLICY_PASS 8/8");
