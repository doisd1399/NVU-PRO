import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const coordinator = read("src/services/operationalCompletionCoordinator.ts");
const recordTrip = read("src/pages/driver/RecordTrip.tsx");
const appContext = read("src/context/AppContext.tsx");
const bridge = read("src/components/SimpleAutomationCompletionBridge.tsx");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const handoff = read("src/lib/operationCompletionResult.ts");
const proService = read("src/services/simpleAutomationCompletionService.ts");
const adapter = read("src/services/sync/FirebaseTripSyncAdapter.ts");
const command = read("src/application/trip/CanonicalTripCommandService.ts");
const syncEngine = read("src/services/sync/SyncEngine.ts");
const operationService = read("src/application/trip/CanonicalTripOperationService.ts");
const operationOutbox = read("src/services/operationOutbox.ts");
const durableOutbox = read("src/application/operation/DurableOperationOutbox.ts");
const operationFinalizer = read("functions/src/finalizeCanonicalOperation.ts");
const manualFinalizer = read("functions/src/completeCanonicalOperation.ts");
const completionFlow = read("src/application/operation/FinalizeOperation.ts");
const serverWriter = read("functions/src/registerCanonicalSimpleTrip.ts");
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(/IN_FLIGHT\s*=\s*new Map/.test(coordinator), "deve existir in-flight dedupe por chave");
assert(/createIdempotencyKey/.test(coordinator) && /IN_FLIGHT\.get\(flightKey\)/.test(coordinator), "duplicidade deve reutilizar execução idempotente");
assert(/publishTripHistoryOptimistically/.test(coordinator) && /await input\.addTrip/.test(coordinator), "histórico só deve ser projetado após identidade durável local/servidor");
assert(!/input\.persistTripId\(docRef\)/.test(coordinator), "tripId deve ser atribuído na gravação canônica, sem updateDoc secundário");
assert(/docRef\.data/.test(coordinator), "o retorno server-confirmed deve alimentar a projeção reconciliada");
assert(/await input\.syncJobProgress!/.test(coordinator) && /deferOperationReconciliation/.test(coordinator), "reconciliação deve consultar contagem server-side e permitir Pro deferred");
assert(/void reconcile\(\)/.test(coordinator) && /operationReadyToFinalize/.test(coordinator), "coordenador deve expor prontidão sem finalizar a operação automaticamente");
assert(!/input\.finishJob/.test(coordinator), "registro de viagem nunca pode acionar Finalizar Operação automaticamente");
assert(/actualProgress\s*>?=\s*operationTotalDeliveries/.test(coordinator) && /awaiting_completion/.test(coordinator), "total reconciliado deve mover apenas para awaiting_completion");
assert(/docRef\.offline\s*===\s*true/.test(coordinator) && /operationStatus\s*=\s*isOfflineTrip\s*\?\s*"pending_validation"/.test(coordinator), "registro offline deve permanecer aguardando validação");
assert(!/projectedProgress\s*>=\s*operationTotalDeliveries/.test(coordinator), "progresso projetado não pode concluir operação");
assert(/completeTripWithCoordinator/.test(recordTrip), "Print deve usar coordenador único");
assert(appContext.includes("finishJobInFlightRef") && appContext.includes("operationOutbox.enqueueFinish")
  && appContext.includes("pendingSync: true"), "finishJob deve persistir a solicitação no outbox e deduplicar até o ACK server-side");
assert(/await tx\.get\(/.test(manualFinalizer) && /buildCanonicalOperationProjection/.test(manualFinalizer)
  && /OPERATION_TRIPS_NOT_VALIDATED/.test(manualFinalizer), "o callable deve recontar viagens canônicas na transação do servidor");
assert(operationOutbox.includes("sendFinish: entry => canonicalTripOperationService.finalizeOperation(entry.jobId)")
  && operationService.includes('"completeCanonicalOperation"'), "Finalizar Operação deve chamar o callable explícito autenticado");
assert(durableOutbox.includes("result?.completed !== true") && durableOutbox.includes('result.status !== "completed"')
  && durableOutbox.includes('state: "CONFIRMED"') && durableOutbox.includes('entry.state === "CONFIRMED"')
  && durableOutbox.includes('status: "completed", progress: result.progress')
  && appContext.includes("operationOutbox.project(serverJobs as any[], currentUser.id, activeCompanyId)")
  && appContext.includes("operationOutbox.observe(uid, targetCompanyId, nextJobs)"),
  "fechamento terminal deve ser projetado localmente somente após ACK validado e snapshot observado");
assert(/settleCanonicalOperationCompletion/.test(operationFinalizer) && /notifications/.test(operationFinalizer) && /status: "available"/.test(operationFinalizer), "notificação e liberação de recursos devem ser efeitos server-side idempotentes");
assert(/driver-explicit-confirmation/.test(manualFinalizer) && /operationCompletionPatch/.test(manualFinalizer), "transição terminal deve existir somente no callable manual autenticado");
assert(completionFlow.includes('completion?.completed !== true') && completionFlow.includes('completion.status !== "completed"')
  && /handleFirebaseError\(e\);\s*throw e;/.test(appContext), "o ACK terminal deve ser validado e erros de finalização propagados");
assert(/operationReadyToFinalize/.test(recordTrip) && /navigate\("\/driver\/dashboard", \{ replace: true \}\)/.test(recordTrip), "Print final deve voltar ao Dashboard sem pular o botão de finalização");
assert(!/publishOperationCompletionResult/.test(recordTrip), "Print não pode publicar resultado antes do clique em Finalizar Operação");
assert(/operationWillClose/.test(proService) && /deferOperationReconciliation: !operationWillClose/.test(proService), "Pro deve reconciliar terminalidade no momento de fechamento");
assert(/addTripWithinOperationLimit/.test(recordTrip) && /addTripWithinOperationLimit/.test(proService), "Print e Pro devem usar o mesmo comando canônico");
assert(/registerCanonicalSimpleTrip/.test(adapter), "Simple não-GTO deve usar writer callable server-side");
assert(/trip_request_locks/.test(serverWriter), "server write deve manter lock idempotente");
assert(/getDocFromServer\(tripRef\)/.test(adapter) && /serverValidatedAt/.test(adapter), "replay só confirma após releitura server-only com marcador de ACK");
assert(!/operationSlot/.test(adapter) && !/progress:\s*progress\s*\+\s*1/.test(adapter), "Simple não-GTO não pode calcular slot/progresso no cliente");
assert(/result\.confirmed !== true/.test(syncEngine) && /state: "SERVER_CONFIRMED"/.test(syncEngine), "fila só muda para confirmed com ACK explícito do servidor");
assert(/reconcileConfirmedTrip\(confirmedTrip\)/.test(syncEngine), "ACK deve alimentar reconciliação store/eventos");
assert(/getDocsFromServer/.test(operationService) && /where\("jobId", "==", jobId\)/.test(operationService), "operação atual deve ser contada pelo Firestore server-only");
assert(/OperationResultModal/.test(dashboard) && /handleFinishJob/.test(dashboard), "resultado deve abrir no Dashboard somente após Finalizar Operação");
assert(!/publishOperationCompletionResult/.test(bridge) && /receiptCaptured/.test(bridge), "Pro deve observar a fila nativa sem publicar handoff Web");
assert(/nvuOperationResult/.test(dashboard) && /sessionStorage/.test(handoff), "handoff do resultado deve sobreviver à navegação no WebView");

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("operational-completion-coordinator: PASS trip ACK -> awaiting_completion -> explicit manual finalization -> result modal");
