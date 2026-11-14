import assert from "node:assert/strict";
import { buildInProgressOperationSummary } from "../src/lib/operationResultSummary.ts";
import type { Job, Contract, CompanyProfile } from "../src/context/AppContext.tsx";

const job = {
  id: "operation-a", driverId: "driver-a", companyId: "company-a", contractId: "contract-a",
  vehicleId: "vehicle-a", vehicleName: "Volvo FH 16", trailerName: "Graneleiro 4 eixos",
  status: "active", progress: 99, assignedAt: "2026-10-15T10:00:00Z", dueAt: "2026-10-18T12:00:00Z",
} as unknown as Job;
const contract = { id: "contract-a", companyId: "company-a", name: "BLS - 130", totalDeliveries: 12 } as Contract;
const companies = [
  { id: "company-b", companyName: "Outra empresa" },
  { id: "company-a", companyName: "DC Transportes" },
] as CompanyProfile[];
const valid = Array.from({ length: 7 }, (_, index) => ({
  id: `receipt-${index}`, jobId: job.id, driverId: job.driverId, companyId: job.companyId,
  contractId: job.contractId, status: "completed", recordStatus: "completed",
  serverValidatedAt: "2026-10-16T12:00:00Z", completedAt: "2026-10-16T12:00:00Z",
  valorCents: 10001, currency: "BRL",
}));
const trips = [...valid, valid[0],
  { ...valid[0], id: "other-job", jobId: "previous-operation" },
  { ...valid[0], id: "other-company", companyId: "company-b" },
  { ...valid[0], id: "other-driver", driverId: "driver-b" },
  { ...valid[0], id: "deleted", deleted: true },
  { ...valid[0], id: "pending", status: "pending_sync" },
];
const input = { job, contract, companies, trips, now: new Date("2026-10-17T12:00:00Z"), showTrailer: true };
const summary = buildInProgressOperationSummary(input);
assert.equal(summary.companyName, "DC Transportes");
assert.equal(summary.contractName, "BLS - 130");
assert.equal(summary.vehicleName, "Volvo FH 16");
assert.equal(summary.trailerName, "Graneleiro 4 eixos");
assert.equal(summary.totalViagens, 7, "Deduplicated confirmed trips, never the denormalized 99 counter");
assert.equal(summary.moneyGroups?.[0].value, 700.07, "Foreign, deleted, pending and duplicate receipts never affect earnings");
assert.equal(summary.tempoExecucao, "2d 2h 0min", "Execution runs through now, not the last receipt date");
assert.equal(summary.tempoRestante, "1d 0h 0min");
assert.equal(summary.prazoLimite, "18/10/2026");
assert.equal(summary.isAtrasado, false);
const later = buildInProgressOperationSummary({ ...input, now: new Date("2026-10-17T13:00:00Z") });
assert.equal(later.tempoRestante, "23h 0min");
assert.equal(later.tempoExecucao, "2d 3h 0min");
const overdue = buildInProgressOperationSummary({ ...input, now: new Date("2026-10-19T12:00:00Z") });
assert.equal(overdue.isAtrasado, true);
assert.equal(overdue.tempoRestante, "1d 0h 0min");
const noDeadline = buildInProgressOperationSummary({ ...input, job: { ...job, dueAt: undefined, deadlineDate: "invalid" } });
assert.equal(noDeadline.hasDeadline, false);
assert.equal(noDeadline.isAtrasado, false);
assert.equal(noDeadline.prazoLimite, "Não definido");
const lateCompany = buildInProgressOperationSummary({ ...input, companies: [], job: { ...job, companyName: "Empresa do vínculo" } as Job });
assert.equal(lateCompany.companyName, "Empresa do vínculo", "Assignment snapshot supplies the name before catalog arrival");
const absentCompany = buildInProgressOperationSummary({ ...input, companies: [companies[0]], contract: { ...contract, companyId: "company-b", companyName: "Nome de outro vínculo" } });
assert.equal(absentCompany.companyName, "Empresa não informada", "Never borrow another company's identity");
const mixed = buildInProgressOperationSummary({ ...input, trips: [valid[0], { ...valid[1], currency: "EUR", valorCents: 12345 }] });
assert.equal(mixed.totalViagens, 2);
assert.equal(mixed.moneyGroups?.find(group => group.currency === "EUR")?.value, 123.45);
assert.equal(mixed.moneyGroups?.find(group => group.currency === "BRL")?.value, 100.01);
const empty = buildInProgressOperationSummary({ ...input, trips: [], showTrailer: false });
assert.equal(empty.totalViagens, 0);
assert.deepEqual(empty.moneyGroups, []);
assert.equal(empty.showTrailer, false);
console.log("PASS live operation summary: account/company/job isolation, confirmed receipts, deduplication, exact currency totals, live clock, deadlines, late/absent company data and empty states.");
