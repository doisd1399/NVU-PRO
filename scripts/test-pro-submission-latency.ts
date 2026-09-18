import { completeTripWithCoordinator } from "../src/services/operationalCompletionCoordinator";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const measure = async (deferred: boolean): Promise<{ elapsedMs: number; reconciled: boolean }> => {
  let reconciled = false;
  const startedAt = performance.now();
  await completeTripWithCoordinator({
    userId: "latency-test-user",
    companyId: "latency-test-company",
    tripData: {
      idempotencyKey: `latency-${deferred ? "deferred" : "sync"}-${Date.now()}-${Math.random()}`,
    },
    job: { id: `latency-job-${deferred ? "deferred" : "sync"}`, progress: 3 },
    contract: { id: "latency-contract", totalDeliveries: 10 },
    addTrip: async () => {
      await sleep(25);
      return { id: "latency-trip" };
    },
    persistTripId: async () => {
      await sleep(1_000);
    },
    syncJobProgress: async () => {
      await sleep(1_000);
      return 4;
    },
    finishJob: async () => {
      await sleep(1_000);
    },
    deferOperationReconciliation: deferred,
    projectedOperationProgress: 4,
    projectedOperationTotalDeliveries: 10,
    onOperationReconciled: async () => {
      reconciled = true;
    },
  });
  const elapsedMs = performance.now() - startedAt;
  if (deferred) {
    await sleep(1_150);
  }
  return { elapsedMs, reconciled };
};

const deferred = await measure(true);
const synchronous = await measure(false);

if (deferred.elapsedMs >= 500) {
  throw new Error(`O caminho deferred ainda bloqueou ${deferred.elapsedMs.toFixed(1)} ms.`);
}
if (!deferred.reconciled) {
  throw new Error("A reconciliação deferred não foi executada após a durabilidade local.");
}
if (synchronous.elapsedMs < 900) {
  throw new Error(`O baseline síncrono não reproduziu a espera esperada: ${synchronous.elapsedMs.toFixed(1)} ms.`);
}
if (deferred.elapsedMs >= synchronous.elapsedMs) {
  throw new Error("O caminho deferred não foi mais rápido que o baseline síncrono.");
}

console.log(
  `pro-submission-latency: PASS deferred=${deferred.elapsedMs.toFixed(1)}ms `
    + `syncBaseline=${synchronous.elapsedMs.toFixed(1)}ms reconciliation=confirmed`,
);
process.exit(0);
