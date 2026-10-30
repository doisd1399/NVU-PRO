import assert from "node:assert/strict";
import { describeOperationInfo, formatTimeRemaining } from "../src/lib/operationInfo";

// Presentation rules of the "Informações da operação" card: time left, progress and the state of the job.
const NOW = Date.parse("2026-10-29T21:14:00-03:00");
const base = { state: "active" as const, completed: 8, required: 10 };
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log("PASS " + name); };

check("Open job: remaining time as days, hours and minutes, progress and remaining deliveries", () => {
  const view = describeOperationInfo({ ...base, jobStatus: "active", deadlineTimestamp: NOW + 86_400_000 + 13 * 3_600_000 }, NOW);
  assert.deepEqual([view.tone, view.statusLabel, view.timeLabel, view.timeText, view.percent, view.completed, view.required, view.remaining, view.editable], ["active", "Em andamento", "Tempo restante", "1d · 13h · 0min", 80, 8, 10, 2, true]);
  assert.equal(view.timeWarning, true, "Less than two days left is highlighted");
});
check("Plenty of time is not highlighted", () => assert.equal(describeOperationInfo({ ...base, deadlineTimestamp: NOW + 5 * 86_400_000 }, NOW).timeWarning, false));
check("Deadline in the past: late, expired text, still editable", () => {
  const view = describeOperationInfo({ ...base, jobStatus: "active", deadlineTimestamp: NOW - 60_000 }, NOW);
  assert.deepEqual([view.tone, view.statusLabel, view.timeText, view.timeWarning, view.editable], ["overdue", "Atrasado", "Prazo vencido", true, true]);
});
check("Job flagged as delayed by the server without a usable deadline", () => {
  const view = describeOperationInfo({ ...base, state: "overdue" }, NOW);
  assert.deepEqual([view.tone, view.timeText], ["overdue", "Não definido"]);
});
check("No deadline", () => assert.equal(describeOperationInfo({ ...base, deadlineTimestamp: 0 }, NOW).timeText, "Não definido"));
check("Pending job is not late even when the date has passed", () => {
  const view = describeOperationInfo({ ...base, state: "pending", jobStatus: "pending", completed: 0, deadlineTimestamp: NOW - 1 }, NOW);
  assert.deepEqual([view.tone, view.statusLabel, view.percent, view.remaining], ["pending", "Não iniciado", 0, 10]);
});
check("Waiting for completion keeps its own status", () => assert.equal(describeOperationInfo({ ...base, state: "ready", jobStatus: "awaiting_completion", completed: 10, deadlineTimestamp: NOW + 3_600_000 }, NOW).statusLabel, "Aguardando conclusão"));
check("Completed job: 100%, closed text, no editing", () => {
  const view = describeOperationInfo({ ...base, jobStatus: "completed", completed: 9, deadlineTimestamp: NOW - 86_400_000 }, NOW);
  assert.deepEqual([view.tone, view.statusLabel, view.timeLabel, view.timeText, view.percent, view.timeWarning, view.editable], ["done", "Concluído", "Situação", "Operação encerrada", 100, false, false]);
});
check("Cancelled job keeps the deliveries already registered and cannot be changed", () => {
  const view = describeOperationInfo({ ...base, jobStatus: "cancelled", deadlineTimestamp: NOW + 86_400_000 }, NOW);
  assert.deepEqual([view.tone, view.statusLabel, view.timeText, view.completed, view.percent, view.timeWarning, view.editable], ["cancelled", "Cancelado", "Trabalho cancelado", 8, 80, false, false]);
});
check("More deliveries than required never exceed 100% or go negative", () => {
  const view = describeOperationInfo({ ...base, completed: 14 }, NOW);
  assert.deepEqual([view.percent, view.remaining], [100, 0]);
});
check("Unknown total: no percentage invented, no remaining count", () => {
  const view = describeOperationInfo({ ...base, required: 0, completed: 3 }, NOW);
  assert.deepEqual([view.percent, view.remaining, view.required], [0, 0, 0]);
});
check("Garbage figures are treated as zero", () => {
  const view = describeOperationInfo({ ...base, completed: Number.NaN, required: -4 }, NOW);
  assert.deepEqual([view.completed, view.required, view.percent], [0, 0, 0]);
});
check("formatTimeRemaining at the boundaries", () => {
  assert.equal(formatTimeRemaining(NOW + 59_999, NOW), "0d · 0h · 0min");
  assert.equal(formatTimeRemaining(NOW, NOW), "Prazo vencido");
  assert.equal(formatTimeRemaining(undefined, NOW), "Não definido");
});
console.log(`OPERATION_INFO_VIEW_PASS ${checks} checks`);
