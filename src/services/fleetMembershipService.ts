import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { executeFleetMembershipClient, type MembershipCommand } from "./fleetMembershipClientCore";
const flights = new Map<string, Promise<any>>();
let warmedUid = "";
const warmedCompanies = new Map<string, number>();
/** Move a possible function cold start into the time spent reading candidates.
 * This only reads an opaque command status; it never approves or reserves one. */
export async function prepareFleetMembership(companyId: string, applicationId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || !companyId || !applicationId) return;
  if (warmedUid !== uid) { warmedUid = uid; warmedCompanies.clear(); }
  const now = Date.now();
  if ((warmedCompanies.get(companyId) || 0) + 120_000 > now) return;
  warmedCompanies.set(companyId, now);
  const diagnosticId = `warm-${globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`}`;
  try {
    await httpsCallable(functions, "manageFleetMembership", { timeout: 6_000 })({
      action: "command-status", commandAction: "approve-application", companyId, applicationId, diagnosticId,
    });
  } catch { /* A warm-up failure must never prevent the actual action. */ }
}
export function manageFleetMembership(command: MembershipCommand) {
  const key = JSON.stringify([auth.currentUser?.uid || "", command.action, command.companyId, command.targetUserId,
    command.applicationId, command.requestId, command.role, command.diagnosticId]);
  const existing = flights.get(key);
  if (existing) return existing;
  const callable = httpsCallable<Record<string, unknown>, any>(functions, "manageFleetMembership", { timeout: 25_000 });
  const statusCallable = httpsCallable<Record<string, unknown>, any>(functions, "manageFleetMembership", { timeout: 6_000 });
  const execution = executeFleetMembershipClient(command, {
    ready: () => auth.authStateReady(), getUser: () => auth.currentUser,
    invoke: payload => payload.action === "command-status" ? statusCallable(payload) : callable(payload),
  });
  flights.set(key, execution);
  const cleanup = () => { if (flights.get(key) === execution) flights.delete(key); };
  void execution.then(cleanup, cleanup);
  return execution;
}
