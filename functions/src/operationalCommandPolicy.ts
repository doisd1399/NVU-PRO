import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { analyzeOperationalPreparation, type OperationalPreparation } from "./operationalPreparationModel";
import { hasSeniorClaim } from "./authorization";
import { accountUsable, requireCompanyDriver } from "./companyAccess";
import {
  isWorkModeAllowed,
  normalizeSimulatorKey,
  normalizeWorkModeAvailability,
} from "./operationalWorkModePolicy";
type Data = Record<string, any>;
type Tx = FirebaseFirestore.Transaction;
type DB = FirebaseFirestore.Firestore;
type Context = functions.https.CallableContext;
export const text = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";
export const field = (d: Data, ...keys: string[]): string =>
  keys.map((k) => text(d[k])).find(Boolean) || "";
export const roles = (d: Data): string[] =>
  [...(Array.isArray(d.roles) ? d.roles : []), d.role].map((v) =>
    text(v).toLowerCase(),
  );
export const fail = (
  code: functions.https.FunctionsErrorCode,
  message: string,
  details?: unknown,
): never => {
  throw new functions.https.HttpsError(code, message, details);
};
export function id(value: unknown, label: string): string {
  const result = text(value);
  if (
    !result ||
    result.length > 180 ||
    result.includes("/") ||
    result.includes("\0") ||
    [".", ".."].includes(result)
  )
    fail("invalid-argument", `${label} inválido.`);
  return result;
}
export function millis(value: any): number {
  if (value?.toMillis) return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return typeof value === "number" ? value : Date.parse(String(value || ""));
}
export function assertAccount(user: Data): void {
  // Legacy status can describe the primary company's approval. Canonical
  // membership decides access to this company; global account blocks still win.
  if (!accountUsable(user))
    fail(
      "permission-denied",
      "A conta não está disponível para iniciar novos trabalhos.",
    );
}
export function assertSuspension(user: Data): void {
  if (
    millis(
      user.operationalSuspendedUntil ?? user.operationalSuspension?.endsAt,
    ) > Date.now()
  )
    fail("permission-denied", "Suas atividades operacionais estão suspensas.");
}
export function manager(
  context: Context,
  company: Data,
  memberships: Data[],
  authorization: Data = {},
): boolean {
  const uid = context.auth!.uid;
  return (
    hasSeniorClaim(context) ||
    (authorization.status !== "removed" && authorization.revokedAt == null &&
    ([company.ownerId, company.userId].includes(uid) ||
    memberships.some(
      (m) =>
        m.status === "active" &&
        (roles(m).some((r) => ["admin", "owner"].includes(r)) ||
          (Array.isArray(m.permissions) &&
            m.permissions.some((p: unknown) =>
              ["admin", "owner", "manage_fleet", "all"].includes(text(p)),
            ))),
    )))
  );
}
export async function membership(
  tx: Tx,
  db: DB,
  companyId: string,
  uid: string,
): Promise<Data[]> {
  const result = await tx.get(
    db
      .collection("companyMembers")
      .where("companyId", "==", companyId)
      .where("userId", "==", uid),
  );
  return result.docs.map((row) => row.data());
}
export async function driverEligibility(
  tx: Tx,
  db: DB,
  companyId: string,
  uid: string,
  allowOperationalSuspension = false,
): Promise<void> {
  const state = await requireCompanyDriver(db, tx, uid, companyId);
  assertAccount(state.user);
  if (!allowOperationalSuspension) assertSuspension(state.user);
}
export function assertCompany(
  company: Data,
  requireOperationalCommandVersion = true,
): void {
  if (
    company.deleted === true ||
    ["deleted", "inactive", "suspended", "rejected", "pending"].includes(
      text(company.status),
    )
  )
    fail(
      "failed-precondition",
      "A empresa não está disponível para novos trabalhos.",
    );
  if (requireOperationalCommandVersion && company.operationalCommandVersion !== 1)
    fail(
      "failed-precondition",
      "A empresa ainda não foi preparada para a confirmação operacional. Contate o responsável.",
    );
}
export async function companySimulatorKey(
  tx: Tx,
  db: DB,
  company: Data,
): Promise<string> {
  let key = [company.simulatorId, company.simulatorName]
    .map(normalizeSimulatorKey)
    .find(Boolean);
  if (!key && text(company.simulatorId)) {
    const catalog = await tx.get(
      db.collection("simulators").doc(id(company.simulatorId, "Simulador")),
    );
    const data = catalog.data() || {};
    key = [data.key, data.code, data.name]
      .map(normalizeSimulatorKey)
      .find(Boolean);
  }
  if (!key)
    fail(
      "failed-precondition",
      "O simulador da empresa precisa ser conferido.",
    );
  return key!;
}
export async function simulatorKey(
  tx: Tx,
  db: DB,
  company: Data,
  contract: Data,
): Promise<string> {
  const companyKey = await companySimulatorKey(tx, db, company);
  const contractKey = [contract.simulatorId, contract.simulator]
    .map(normalizeSimulatorKey)
    .find(Boolean);
  if (!contractKey || companyKey !== contractKey)
    fail(
      "failed-precondition",
      "O simulador da operação precisa ser conferido pela empresa.",
    );
  return companyKey;
}
export async function maintenance(tx: Tx, db: DB, key: string): Promise<void> {
  const settings = await tx.get(db.collection("settings").doc("system"));
  const availability = normalizeWorkModeAvailability(
    settings.get("workModeAvailability"),
  );
  if (
    !(["print", "pro", "max"] as const).some((mode) =>
      isWorkModeAllowed(availability, mode, key),
    )
  )
    fail(
      "failed-precondition",
      "Novas operações estão temporariamente pausadas para este simulador.",
    );
}
export function snapshot(
  contract: Data,
  contractId: string,
  companyId: string,
  simulator: string,
  totalOverride?: unknown,
): Data {
  const total = Number(totalOverride ?? contract.totalDeliveries);
  const days = Number(contract.deadlineDays);
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    !Number.isSafeInteger(days) ||
    days < 1
  )
    fail("failed-precondition", "A meta ou o prazo da operação é inválido.");
  if (contract.mode != null && !["simple", "detailed"].includes(contract.mode))
    fail("failed-precondition", "O modo da operação é inválido.");
  const mode = contract.mode === "detailed" ? "detailed" : "simple";
  const deliveries =
    mode === "detailed" && Array.isArray(contract.deliveries)
      ? contract.deliveries.map((d: Data, index: number) => ({
          id: text(d.id) || `${contractId}_${index}`,
          origin: text(d.origin),
          destination: text(d.destination),
        }))
      : [];
  if (
    mode === "detailed" &&
    (deliveries.length !== total ||
      deliveries.some((d: Data) => !d.origin || !d.destination))
  )
    fail(
      "failed-precondition",
      "O roteiro não corresponde à meta da operação.",
    );
  const result = {
    id: contractId,
    companyId,
    name: text(contract.name),
    simulator: text(contract.simulator) || simulator,
    simulatorId: simulator,
    totalDeliveries: total,
    deadlineDays: days,
    mode,
    deliveries,
    trailerId: ["wbds", "pbs"].includes(simulator)
      ? null
      : text(contract.trailerId) || null,
    snapshotVersion: 1,
  };
  if (!result.name || Buffer.byteLength(JSON.stringify(result)) > 500_000)
    fail(
      "failed-precondition",
      "Os dados da operação precisam ser revisados pela empresa.",
    );
  return result;
}
export async function assets(
  tx: Tx,
  db: DB,
  companyId: string,
  vehicleId: string,
  trailerId: string | null,
): Promise<{ vehicle: Data; trailer: Data }> {
  const [v, t] = await Promise.all([
    tx.get(db.collection("veiculos").doc(vehicleId)),
    trailerId
      ? tx.get(db.collection("reboques").doc(id(trailerId, "Reboque")))
      : Promise.resolve(null),
  ]);
  const vehicle = v.data() || {},
    trailer = t?.data() || {};
  if (
    !v.exists ||
    vehicle.companyId !== companyId ||
    vehicle.deleted === true ||
    vehicle.status === "maintenance"
  )
    fail(
      "failed-precondition",
      "O veículo não está disponível para iniciar esta operação.",
    );
  if (
    trailerId &&
    (!t?.exists ||
      trailer.companyId !== companyId ||
      trailer.deleted === true ||
      trailer.status === "maintenance")
  )
    fail(
      "failed-precondition",
      "O reboque não está disponível para esta operação.",
    );
  return { vehicle, trailer };
}

export async function readOperationalPreparation(
  tx: Tx,
  db: DB,
  companyId: string,
): Promise<OperationalPreparation> {
  const [jobs, aliases] = await Promise.all([
    tx.get(db.collection("trabalhos").where("companyId", "==", companyId)),
    tx.get(db.collection("trabalhos").where("empresaId", "==", companyId)),
  ]);
  const all = new Map(
    [...jobs.docs, ...aliases.docs].map((row) => [row.id, row]),
  );
  const records = [...all.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Any job edit or insertion invalidates a pending repair confirmation.
  const token = createHash("sha256").update(JSON.stringify(records.map((row) =>
    [row.id, row.updateTime ? [row.updateTime.seconds, row.updateTime.nanoseconds] : null, row.data()]))).digest("hex");
  return { ...analyzeOperationalPreparation(records.map((row) =>
    ({ id: row.id, data: row.data() })), companyId), token };
}
