import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const coordinator = fs.readFileSync(
  path.join(root, "src/services/operationalCompletionCoordinator.ts"),
  "utf8",
);
const recordTrip = fs.readFileSync(
  path.join(root, "src/pages/driver/RecordTrip.tsx"),
  "utf8",
);
const appContext = fs.readFileSync(
  path.join(root, "src/context/AppContext.tsx"),
  "utf8",
);
const bridge = fs.readFileSync(
  path.join(root, "src/components/SimpleAutomationCompletionBridge.tsx"),
  "utf8",
);
const dashboard = fs.readFileSync(
  path.join(root, "src/pages/driver/Dashboard.tsx"),
  "utf8",
);
const handoff = fs.readFileSync(
  path.join(root, "src/lib/operationCompletionResult.ts"),
  "utf8",
);
const proService = fs.readFileSync(
  path.join(root, "src/services/simpleAutomationCompletionService.ts"),
  "utf8",
);
const tripsRepository = fs.readFileSync(
  path.join(root, "src/repositories/TripsRepository.ts"),
  "utf8",
);

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(/IN_FLIGHT\s*=\s*new Map/.test(coordinator), "deve existir in-flight dedupe por chave");
assert(/createIdempotencyKey/.test(coordinator), "deve existir idempotencyKey determinística");
assert(/IN_FLIGHT\.get\(idempotencyKey\)/.test(coordinator), "duplicidade deve reutilizar a execução existente");
assert(/publishTripHistoryOptimistically/.test(coordinator), "o histórico deve ser publicado após addTrip");
assert(/input\.persistTripId\(docRef\)/.test(coordinator), "tripId deve continuar sendo persistido no mesmo documento");
assert(/void Promise\.resolve\(\)[\s\S]{0,180}persistTripId\(docRef\)/.test(coordinator), "persistência redundante de tripId não pode bloquear a confirmação");
assert(!/await input\.persistTripId\(docRef\)/.test(coordinator), "persistência redundante de tripId não deve estar no caminho crítico");
assert(/await input\.syncJobProgress!/.test(coordinator), "a reconciliação deve consultar a contagem server-side");
assert(/deferOperationReconciliation/.test(coordinator), "Pro deve poder reconciliar progresso em segundo plano");
assert(/void reconcile\(\)/.test(coordinator), "reconciliação deferred deve ser iniciada sem bloquear o retorno");
assert(/operationClosed/.test(coordinator), "coordenador deve devolver terminalidade da operação");
assert(/operationTotalDeliveries\s*>\s*0\s*&&\s*projectedProgress\s*>=\s*operationTotalDeliveries/.test(coordinator), "job só pode concluir quando total canônico for atingido");
assert(/completeTripWithCoordinator/.test(recordTrip), "RecordTrip deve usar o coordenador único");
assert(!/syncJobProgress\(activeJob\.id\)[\s\S]{0,700}finishJob\(activeJob\.id\)/.test(recordTrip), "RecordTrip não deve manter uma segunda cadeia de conclusão");
assert(/finishJobInFlightRef/.test(appContext), "finishJob deve possuir proteção in-flight");
assert(/freshJobSnapshot/.test(appContext), "finishJob deve consultar estado fresco antes de concluir");
assert(/status: \"completed\"/.test(appContext), "finishJob deve atualizar o job localmente após confirmação");
assert(/createCorporateNotifications/.test(appContext), "notificação continua pertencendo à conclusão canônica");
assert(/getDocFromServer\(completionRef\)/.test(appContext), "finishJob deve confirmar o status terminal no servidor");
assert(/handleFirebaseError\(e\);\s*throw e;/.test(appContext), "falha terminal não pode ser engolida por finishJob");
assert(/publishOperationCompletionResult/.test(recordTrip), "Print deve publicar o payload do modal ao concluir a operação");
assert(/state: \{ nvuOperationResult: completedOperationResultData \}/.test(recordTrip), "Print deve transportar o resultado ao Dashboard");
assert(/operationWillClose/.test(proService), "Pro deve identificar a última viagem antes da reconciliação");
assert(/addTripWithinOperationLimit/.test(recordTrip), "Print deve gravar a viagem dentro do limite transacional");
assert(/addTripWithinOperationLimit/.test(proService), "Pro deve gravar a viagem dentro do limite transacional");
assert(/runTransaction\(db/.test(tripsRepository), "limite de viagens deve ser serializado pelo Firestore");
assert(/OPERATION_TRIP_LIMIT_REACHED/.test(tripsRepository), "viagem além do total deve ser bloqueada explicitamente");
assert(/Math\.min\(realProgress, totalDeliveries\)/.test(tripsRepository), "progresso persistido deve ser limitado ao total canônico");
assert(/deferOperationReconciliation: !operationWillClose/.test(proService), "Pro deve aguardar a reconciliação terminal");
assert(/publishOperationCompletionResult/.test(bridge), "Pro deve publicar o payload do modal ao concluir a operação");
assert(/OPERATION_RESULT_READY_EVENT/.test(dashboard), "Dashboard deve escutar o handoff do resultado");
assert(/nvuOperationResult/.test(dashboard), "Dashboard deve consumir o resultado transportado na rota");
assert(/sessionStorage/.test(handoff), "handoff deve sobreviver à navegação no WebView");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("operational-completion-coordinator: PASS idempotency, durable history, deferred Pro reconciliation, terminal completion and single finishJob owner");
