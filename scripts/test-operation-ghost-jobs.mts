import assert from "node:assert/strict";
import { selectBlockingRunningJobs, selectCurrentOperationJob, selectCurrentOperationJobs, selectHiddenRunningJobs } from "../src/lib/currentOperation.ts";
import { canManageCompanyOperations, isDriverOutsideCompany, isManagedOperation, isOpenSupportJob, listOpenSupportJobs, supportJobName, supportStatusLabel } from "../src/lib/seniorOperationSupport.ts";

// Relato (Dudu TV): "Finalize sua operação atual antes de iniciar outra" sem nenhuma operação visível no painel do motorista, e a empresa
// só via a operação nova (não iniciada). A regra de exibição esconde trabalhos antigos "em andamento" (legado, mais antigos que o último
// concluído), mas o início conta TODOS os trabalhos em execução do motorista na empresa — o servidor também.
const C = "company-1", D = "dudu";
const ghost = { id: "old-active", companyId: C, driverId: D, status: "active", assignedAt: "2026-10-01T10:00:00Z" };         // legado, antigo
const done = { id: "done", companyId: C, driverId: D, status: "completed", assignedAt: "2026-10-20T10:00:00Z", operationalCommandVersion: 1 };
const next = { id: "A.70", companyId: C, driverId: D, status: "pending", assignedAt: "2026-11-05T10:00:00Z", operationalCommandVersion: 1 };
const jobs = [ghost, done, next];

assert.equal(selectCurrentOperationJob(jobs, D, C), null, "o painel do motorista não mostra operação ativa (pendente nunca é atual; a antiga é escondida)");
assert.deepEqual(selectCurrentOperationJobs(jobs, C), [], "a lista da empresa também não a escolhe como atual");
assert.deepEqual(selectHiddenRunningJobs(jobs, C).map(job => job.id), ["old-active"], "ela é um trabalho em execução que nenhuma tela mostra");
assert.deepEqual(selectBlockingRunningJobs(jobs, D, C, "A.70").map(job => job.id), ["old-active"], "e é ela que bloqueia o início da A.70");

// Sem outro trabalho em execução, nada bloqueia; o próprio trabalho a iniciar, trabalhos de outra empresa/motorista e removidos não contam.
assert.deepEqual(selectBlockingRunningJobs([done, next], D, C, "A.70"), []);
assert.deepEqual(selectBlockingRunningJobs([{ ...ghost, companyId: "other" }, { ...ghost, id: "x", driverId: "outro" }, { ...ghost, id: "y", deleted: true }], D, C, "A.70"), []);
assert.deepEqual(selectBlockingRunningJobs([{ ...next, id: "A.70", status: "active" }], D, C, "A.70"), [], "re-entrar na mesma operação não é conflito");
for (const status of ["active", "delayed", "awaiting_completion"]) assert.equal(selectBlockingRunningJobs([{ ...ghost, status }], D, C, "A.70").length, 1, status);
for (const status of ["pending", "completed", "cancelled"]) assert.equal(selectBlockingRunningJobs([{ ...ghost, status }], D, C, "A.70").length, 0, status);
assert.deepEqual(selectBlockingRunningJobs(jobs, "", C), []);

// Dois trabalhos em execução do mesmo motorista: só um é "atual", o outro fica escondido mas continua bloqueando.
const twoManaged = [{ ...done, id: "m1", status: "active", assignedAt: "2026-11-01T10:00:00Z" }, { ...done, id: "m2", status: "active", assignedAt: "2026-11-02T10:00:00Z" }];
assert.equal(selectCurrentOperationJob(twoManaged, D, C)?.id, "m2");
assert.deepEqual(selectHiddenRunningJobs(twoManaged, C).map(job => job.id), ["m1"]);

// Suporte do Sênior: lista todos os trabalhos em aberto da empresa (inclusive o escondido), em execução primeiro.
const all = [...jobs, { id: "c", companyId: C, driverId: "x", status: "cancelled" }, { id: "d", companyId: "other", driverId: D, status: "active" }, { id: "e", companyId: C, driverId: D, status: "pending", deleted: true },
  { id: "late", companyId: C, driverId: "y", status: "delayed", assignedAt: "2026-10-05T10:00:00Z" }, { id: "wait", companyId: C, driverId: "z", status: "awaiting_completion" }];
assert.deepEqual(listOpenSupportJobs(all, C).map(job => job.id), ["wait", "old-active", "late", "A.70"]);
assert.equal(isOpenSupportJob({ status: "active" }), true); assert.equal(isOpenSupportJob({ status: "completed" }), false); assert.equal(isOpenSupportJob({ status: "active", deleted: true }), false);
assert.equal(supportStatusLabel("pending"), "Não iniciado"); assert.equal(supportStatusLabel("active"), "Em andamento"); assert.equal(supportStatusLabel("delayed"), "Atrasado"); assert.equal(supportStatusLabel("awaiting_completion"), "Aguardando finalização");
assert.equal(supportJobName({ id: "1", contractNameSnapshot: "A.70" }), "A.70"); assert.equal(supportJobName({ id: "1", contractSnapshot: { name: "B.1" } }), "B.1"); assert.equal(supportJobName({ id: "1" }), "Operação sem nome");
assert.equal(isManagedOperation({ operationalCommandVersion: 1 }, null), true); assert.equal(isManagedOperation({}, { operationalCommandVersion: 1 }), true); assert.equal(isManagedOperation({}, {}), false); assert.equal(isManagedOperation(null, undefined), false);

// Quem pode cancelar/trocar veículo nas telas da empresa: dono, administrador e o Sênior DENTRO desta empresa (antes só dono/admin: o Sênior via os botões desabilitados).
const company = { id: C, ownerId: "owner", userId: "owner" };
const members = [{ companyId: C, userId: "admin1", status: "active", roles: ["admin"] }, { companyId: C, userId: "drv", status: "active", roles: ["driver"] }, { companyId: C, userId: "old-admin", status: "removed", roles: ["admin"] }, { companyId: "other", userId: "admin2", status: "active", roles: ["admin"] }];
const can = (viewerIds: string[], extra: Record<string, unknown> = {}) => canManageCompanyOperations({ viewerIds, company, members, ...extra } as any);
assert.equal(can(["owner"]), true); assert.equal(can(["admin1"]), true);
assert.equal(can(["drv"]), false); assert.equal(can(["old-admin"]), false); assert.equal(can(["admin2"]), false); assert.equal(can([""]), false); assert.equal(can([]), false);
assert.equal(can(["senior"]), false, "Sênior sem sessão de empresa não age pela tela da empresa");
assert.equal(can(["senior"], { seniorCompanyId: C, seniorAccess: true }), true, "Sênior dentro desta empresa");
assert.equal(can(["senior"], { seniorCompanyId: "other", seniorAccess: true }), false, "Sênior dentro de outra empresa");
assert.equal(can(["senior"], { seniorCompanyId: C, seniorAccess: false }), false, "sessão Sênior não confirmada");
assert.equal(canManageCompanyOperations({ viewerIds: ["senior"], company: null, members, seniorCompanyId: C, seniorAccess: true }), false);
// Motorista que já saiu da empresa (removido da frota): o trabalho dele ficou aberto. Sem a lista de membros carregada, ninguém é "ex-membro".
const co = { id: C, ownerId: "owner", userId: "owner" };
const roster = [{ companyId: C, userId: "ativo", status: "active" }, { companyId: C, userId: "removido", status: "removed" }, { companyId: C, userId: "pendente", status: "pending" }, { companyId: "outra", userId: "dudu", status: "active" }];
const outside = (driverId: string, over: Record<string, unknown> = {}) => isDriverOutsideCompany({ driverId, company: co, members: roster, membersReady: true, ...over } as any);
assert.equal(outside("dudu"), true, "Dudu é membro de OUTRA empresa, não desta");
assert.equal(outside("removido"), true); assert.equal(outside("pendente"), true); assert.equal(outside("desconhecido"), true);
assert.equal(outside("ativo"), false); assert.equal(outside("owner"), false, "o dono nunca é ex-membro");
assert.equal(outside("dudu", { membersReady: false }), false, "lista ainda não carregada: não conclui nada");
assert.equal(outside("dudu", { members: null }), false); assert.equal(outside(""), false); assert.equal(outside("dudu", { company: null }), false);
console.log("trabalhos escondidos × bloqueio de início e suporte do Sênior: ok");
