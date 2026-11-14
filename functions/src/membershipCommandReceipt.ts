import { createHash } from "node:crypto";
import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { accountUsable } from "./companyAccess";

export type MembershipCommandReceipt = {
  ref: FirebaseFirestore.DocumentReference;
  actorUid: string;
  commandId: string;
  fingerprint: string;
};

export function membershipCommandReceipt(db: FirebaseFirestore.Firestore, input: any, actorUid: string): MembershipCommandReceipt {
  const commandId = String(input?.diagnosticId || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(commandId))
    throw new functions.https.HttpsError("invalid-argument", "Identificador da ação inválido.");
  const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const command = [input.action === "command-status" ? input.commandAction : input.action,
    input.companyId, input.targetUserId, input.applicationId, input.requestId, input.role, input.reason].map(clean);
  return { ref: db.collection("fleet_membership_commands").doc(createHash("sha256").update(JSON.stringify([actorUid, commandId])).digest("hex")),
    actorUid, commandId, fingerprint: createHash("sha256").update(JSON.stringify(command)).digest("hex") };
}

function readResult(data: FirebaseFirestore.DocumentData, receipt: MembershipCommandReceipt) {
  if (data.actorUid !== receipt.actorUid || data.fingerprint !== receipt.fingerprint || data.result?.success !== true)
    throw new functions.https.HttpsError("failed-precondition", "A referência desta ação já foi usada para outra alteração.",
      { diagnosticId: receipt.commandId, reasonCode: "MEMBERSHIP_COMMAND_CONFLICT", retryable: false });
  return data.result;
}

/** Mutation and ACK share the same transaction. Lost responses cannot repeat an old removal. */
export function runMembershipTransaction<T>(db: FirebaseFirestore.Firestore,
  receipt: MembershipCommandReceipt | undefined, work: (tx: FirebaseFirestore.Transaction) => Promise<T>): Promise<T> {
  return db.runTransaction(async tx => {
    if (receipt) {
      const saved = await tx.get(receipt.ref);
      if (saved.exists) {
        const actor = await tx.get(db.collection("users").doc(receipt.actorUid));
        if (!actor.exists || !accountUsable(actor.data() || {}))
          throw new functions.https.HttpsError("permission-denied", "Conta suspensa ou indisponível.");
        return readResult(saved.data() || {}, receipt) as T;
      }
    }
    const result = await work(tx);
    if (!receipt) return result;
    const confirmed = { ...result, commandId: receipt.commandId, membershipProtocolVersion: 513 };
    tx.create(receipt.ref, { actorUid: receipt.actorUid, fingerprint: receipt.fingerprint,
      result: confirmed, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return confirmed;
  });
}

export function readMembershipCommandStatus(db: FirebaseFirestore.Firestore, receipt: MembershipCommandReceipt) {
  return db.runTransaction(async tx => {
    const [actor, saved] = await Promise.all([
      tx.get(db.collection("users").doc(receipt.actorUid)), tx.get(receipt.ref),
    ]);
    if (!actor.exists || !accountUsable(actor.data() || {}))
      throw new functions.https.HttpsError("permission-denied", "Conta suspensa ou indisponível.");
    return saved.exists
      ? { commandStatus: "COMPLETED", result: readResult(saved.data() || {}, receipt), membershipProtocolVersion: 513 }
      : { commandStatus: "NOT_FOUND", membershipProtocolVersion: 513 };
  });
}
