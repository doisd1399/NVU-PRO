import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v1/https";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type SimulatorKey = "gto" | "wtds" | "wbds" | "toe3";
type WorkMode = "print" | "pro" | "max";
const supported: Record<WorkMode, SimulatorKey[]> = {
  print: ["gto", "wtds", "wbds", "toe3"],
  pro: ["gto", "wtds", "wbds", "toe3"],
  max: ["gto"],
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const getPayload = (data: unknown): { expectedVersion: number; availability: Record<string, unknown> } => {
  const payload = asRecord(data);
  if (!isInteger(payload.expectedVersion)) throw new HttpsError("invalid-argument", "expectedVersion inválido.");
  const availability = asRecord(payload.availability);
  if (!isInteger(availability.version)) throw new HttpsError("invalid-argument", "version inválida.");
  return { expectedVersion: payload.expectedVersion, availability };
};

const sanitizeMode = (mode: WorkMode, value: unknown): Record<string, unknown> => {
  const source = asRecord(value);
  if (source.enabled !== undefined && !isBoolean(source.enabled)) throw new HttpsError("invalid-argument", `${mode}.enabled inválido.`);
  const sourceSimulators = asRecord(source.simulators);
  const simulators: Record<string, boolean> = {};
  for (const key of supported[mode]) {
    const simulatorValue = sourceSimulators[key];
    if (simulatorValue !== undefined && !isBoolean(simulatorValue)) {
      throw new HttpsError("invalid-argument", `${mode}.simulators.${key} inválido.`);
    }
    // Missing fields stay active for backwards-compatible documents.
    simulators[key] = simulatorValue !== false;
  }
  return {
    enabled: source.enabled !== false,
    simulators,
  };
};

const sanitizeAvailability = (value: Record<string, unknown>, version: number) => ({
  version,
  print: sanitizeMode("print", value.print),
  pro: sanitizeMode("pro", value.pro),
  max: sanitizeMode("max", value.max),
});

const changedKeys = (previous: Record<string, unknown>, next: Record<string, unknown>) => {
  const modes: WorkMode[] = [];
  const simulators: string[] = [];
  for (const mode of ["print", "pro", "max"] as const) {
    const previousMode = asRecord(previous[mode]);
    const nextMode = asRecord(next[mode]);
    if (previousMode.enabled !== nextMode.enabled) modes.push(mode);
    const previousSimulators = asRecord(previousMode.simulators);
    const nextSimulators = asRecord(nextMode.simulators);
    for (const simulator of supported[mode]) {
      if (previousSimulators[simulator] !== nextSimulators[simulator]) simulators.push(`${mode}:${simulator}`);
    }
  }
  return { modes, simulators };
};

export const updateWorkModeAvailability = onCall(async (data, context) => {
  const auth = context.auth;
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Autenticação obrigatória.");
  if (auth.token.senior !== true) throw new HttpsError("permission-denied", "Apenas usuários Sênior podem alterar o controle de envio.");

  const payload = getPayload(data);
  const systemRef = db.doc("settings/system");
  const auditRef = db.collection("audit_work_mode_availability").doc();
  sanitizeAvailability(payload.availability, payload.expectedVersion + 1);
  let responseVersion = 0;

  await db.runTransaction(async (transaction) => {
    const systemSnapshot = await transaction.get(systemRef);
    const systemData = systemSnapshot.data() || {};
    const current = asRecord(systemData.workModeAvailability);
    const currentVersion = isInteger(current.version) ? current.version : 0;
    if (currentVersion !== payload.expectedVersion) {
      throw new HttpsError("failed-precondition", "A configuração foi alterada por outro Sênior. Recarregue antes de salvar novamente.");
    }
    responseVersion = currentVersion + 1;
    const next = sanitizeAvailability(payload.availability, responseVersion);
    const changes = changedKeys(current, next);
    const actorEmail = typeof auth.token.email === "string" ? auth.token.email : null;
    transaction.set(systemRef, {
      workModeAvailability: {
        ...next,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      },
    }, { merge: true });
    transaction.create(auditRef, {
      actionId: auditRef.id,
      actorUid: auth.uid,
      ...(actorEmail ? { actorEmail } : {}),
      actionType: "WORK_MODE_AVAILABILITY_CHANGED",
      previousState: current,
      newState: next,
      changedModes: changes.modes,
      changedSimulators: changes.simulators,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { success: true, version: responseVersion, actionId: auditRef.id };
});
