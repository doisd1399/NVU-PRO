import { auth } from "../lib/firebase";
import { manageFleetMembership } from "./fleetMembershipService";
import { isWithdrawAcknowledged, parseCapabilities } from "./applicationWithdrawCore";

const known = new Map<string, { at: number; value: Promise<string[]> }>();
const TTL_MS = 60_000;

/** What the published server understands. An old server answers "invalid action": nothing is offered. */
export function loadMembershipCapabilities(): Promise<string[]> {
  const uid = auth.currentUser?.uid || "";
  if (!uid) return Promise.resolve([]);
  const cached = known.get(uid);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = manageFleetMembership({ action: "capabilities", companyId: "" }).then(
    data => parseCapabilities(data),
    error => {
      const code = String(error?.code || "").replace(/^functions\//, "");
      if (code === "invalid-argument" || code === "not-found" || code === "unimplemented") return [] as string[];
      known.delete(uid); // a network failure is not remembered
      throw error;
    });
  known.set(uid, { at: Date.now(), value });
  return value;
}

/** Success is reported only when the server confirms the exact application was withdrawn. */
export async function withdrawApplication(companyId: string, applicationId: string, diagnosticId: string) {
  const data = await manageFleetMembership({ action: "withdraw-application", companyId, applicationId, diagnosticId });
  if (!isWithdrawAcknowledged(data, companyId, applicationId))
    throw Object.assign(new Error("O servidor não confirmou a retirada."), { code: "functions/internal", details: { reasonCode: "MEMBERSHIP_ACK_INVALID", diagnosticId } });
  return data as { success: true; withdrawn: true; companyId: string; applicationId: string };
}
