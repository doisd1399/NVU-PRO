export { syncUserPublicProfile, readPrivateUserProfiles } from "./userProfiles";
import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";
import { createPushDispatcher } from "./pushDispatch";
export { registerPushDevice, revokePushDevice } from "./pushDevices";
import { buildCanonicalProductionAudit } from "./canonicalProductionAudit";
import { requireActiveSenior } from "./seniorAccountCommands";
import { approveFleetMemberCore } from "./fleetMembership";
export { manageFleetMembership } from "./fleetMembership";
export { ensureCompanyAccess, syncCompanyAccessOnMembershipWrite, syncCompanyPublicProfile, syncCompanyAccessOnUserWrite } from "./companyAccess";
export { classifyRemainingDebt } from "./remainingDebtClassifier";
export { manageOperationalGoal } from "./operationalGoals";

if (admin.apps.length === 0) admin.initializeApp();

const db = admin.firestore();

/** Read-only production audit. No document writes are performed by this callable. */
export const auditCanonicalProductionData = functions.region("us-central1").https.onCall(
  async (_input: unknown, context) => {
    await requireActiveSenior(context);
    const [jobs, trips, claims] = await Promise.all([
      db.collection("trabalhos").get(),
      db.collection("historico_viagens").get(),
      db.collection("trip_operation_slots").get(),
    ]);
    return buildCanonicalProductionAudit({
      operations: jobs.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      trips: trips.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      claims: claims.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  },
);

function readEnabledFlag(value: unknown, defaultValue = true) {
  if (typeof value !== "string" || !value.trim()) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  return defaultValue;
}

// Compatibilidade ativada por padrão. A Function só deve ser removida depois
// que nenhum cliente ou regra ainda gravar na coleção `notificacoes`.
const LEGACY_NOTIFICATION_PUSH_ENABLED = readEnabledFlag(
  process.env.ENABLE_LEGACY_NOTIFICATION_PUSH,
);

const sendNotificationDocumentPush = createPushDispatcher(db, message => admin.messaging().sendEachForMulticast(message));
export const pushOnNotificationCreated = functions.runWith({failurePolicy:true}).firestore
  .document("notifications/{notificationId}").onCreate(async(snapshot,context)=>{
    await sendNotificationDocumentPush('notifications',context.params.notificationId,snapshot.data());
  });
export const pushOnLegacyNotificationCreated = functions.runWith({failurePolicy:true}).firestore
  .document("notificacoes/{notificationId}").onCreate(async(snapshot,context)=>{
    if(!LEGACY_NOTIFICATION_PUSH_ENABLED)return;
    await sendNotificationDocumentPush('notificacoes',context.params.notificationId,snapshot.data());
  });

export const sendPushNotification = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "O usuário precisa estar autenticado para enviar notificações.",
    );
  }

  // Compatibilidade com versões antigas do cliente: a função continua
  // existente, mas não dispara FCM. Toda notificação deve nascer em
  // notifications/notificacoes e passar pelo gatilho idempotente acima.
  console.warn(
    "[NVU PUSH] sendPushNotification é legado; envio direto ignorado para evitar duplicação.",
  );
  return {
    success: true,
    skipped: true,
    reason: "notification_documents_are_canonical",
  };
});

/**
 * Repara de forma idempotente o vínculo de uma inscrição já aprovada.
 */
export const repairApprovedMembership = functions.https.onCall(async (data, context) =>
  approveFleetMemberCore(db, context, { applicationId: String(data?.applicationId || ""), repair: true }));

export {
  generateNvuNewsBackfill,
  generateNvuNewsScheduled,
  generateNvuNewsMonthlyScheduled,
  updateNvuNewsClassificationsOnRankingAggregateWrite,
  updateNvuNewsClassificationsOnClosedTripWrite,
  updateNvuNewsClassificationsOnCompanyWrite,
  updateNvuNewsClassificationsOnSimulatorWrite,
} from "./nvuNewsBackfill";
export {
  publishCompanyApprovalNews,
  publishCompanyApprovalNewsOnCompanyCreate,
  publishCompanyApprovalNewsOnOwnerProfileWrite,
  publishCompanyApprovalNewsOnSimulatorWrite,
  syncCompanyApprovalNews,
} from "./companyApprovalNews";
export {
  ensureRankingAggregates,
  getSeniorMonthlyMetrics,
  updateRankingAggregatesOnTripWrite,
  updateRankingAggregatesOnCompanyWrite,
  updateRankingAggregatesOnSimulatorWrite,
} from "./rankingAggregates";
export {
  auditUserStorageImagesOnUpdate,
  auditCompanyStorageImagesOnUpdate,
  auditUserStorageImagesOnDelete,
  auditCompanyStorageImagesOnDelete,
} from "./storageCleanupAudit";
export { authenticateSeniorAccess } from "./seniorAccess";
export {
  approveDriverRequest,
  rejectDriverRequest,
  approveRecruitmentApplication,
  rejectRecruitmentApplication,
} from "./adminOperations";


export { registerGtoTrip } from "./gtoTrips";

export { syncGtoTripState } from "./gtoState";

export { repairInvalidGtoPrintProgress } from "./repairInvalidGtoPrintProgress";
export { registerGtoProReceipt } from "./registerGtoProReceipt";
export { registerCanonicalSimpleTrip } from "./registerCanonicalSimpleTrip";
export { reconcileOperationTrips } from "./reconcileOperationTrips";
export { completeCanonicalOperation } from "./completeCanonicalOperation";
export { operationalCommand, prepareCompanyOperationalCommands, notifyOperationalAssignment } from "./operationalCommands";
export { finalizeCanonicalOperation } from "./finalizeCanonicalOperation";
export {
  ensureRankingParticipantOperations,
  syncRankingParticipantOperations,
  syncRankingVehicleChange,
} from "./rankingParticipantOperations";

export { reconcileOperationProjectionOnTripWrite } from "./reconcileOperationProjectionOnTripWrite";

export { canonicalizeHistoricalTrip, historicalSchemaContractTable } from "./historicalTripCanonicalizer";

export { reconstructOperationHistoricalState, simulateNextTrip, simulateReplay, simulateOfflineQueue } from "./operationHistoricalReconstructor";

export { getOperationalQueues, configureOperationalQueues, refreshOperationalQueueContract, refreshOperationalQueueFolder, refreshOperationalQueueVehicle, refreshOperationalQueueTrailer } from "./operationalQueues";

// Officially recovered senior administration callables (read-only source recovery).
export { removeDriverFromFleetSenior, suspendSeniorAccount, reactivateSeniorAccount, deleteSeniorProfile, reverseSeniorSuspension, endSeniorOperationalSuspension, listSeniorSuspendedMembers } from "./seniorEmployeeActions";
export { updateWorkModeAvailability } from "./workModeAvailability";

export { processSeniorAccountCommand, recoverSeniorAccountCommands } from "./seniorAccountCommands";

export { deleteCompanyCanonical, processCompanyDeletion, recoverCompanyDeletions } from "./companyDeletion";
