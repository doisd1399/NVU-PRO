import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { isGroupUnsupported, isRenameAcknowledged, parseAddResult, parseGroupCapabilities, type AddResult } from "./companyGroupCore";

const callable = httpsCallable<Record<string, unknown>, any>(functions, "manageCompanyGroup", { timeout: 25_000 });
const known = new Map<string, { at: number; value: Promise<string[]> }>();
const TTL_MS = 60_000;
const diagnosticId = () => `group-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** What the published server understands. A server without this feature answers "not found": nothing is offered. */
export function loadCompanyGroupCapabilities(): Promise<string[]> {
  const uid = auth.currentUser?.uid || "";
  if (!uid) return Promise.resolve([]);
  const cached = known.get(uid);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = callable({ action: "capabilities" }).then(
    result => parseGroupCapabilities(result.data),
    error => {
      if (isGroupUnsupported(error)) return [] as string[];
      known.delete(uid); // a network failure is not remembered
      throw error;
    });
  known.set(uid, { at: Date.now(), value });
  return value;
}

/** Success is reported only when the server confirms the answer for this very company. */
export async function addCompanySimulators(companyId: string, simulatorIds: string[], registrationId?: string): Promise<AddResult> {
  const id = diagnosticId();
  const { data } = await callable({ action: "add-simulators", companyId, simulatorIds, ...(registrationId ? { registrationId } : {}), diagnosticId: id });
  const result = parseAddResult(data, companyId);
  if (!result) throw Object.assign(new Error("O servidor não confirmou."), { code: "functions/internal", details: { reasonCode: "GROUP_ACK_INVALID", diagnosticId: id } });
  return result;
}

export async function renameCompanyGroup(companyId: string, companyName: string): Promise<{ companyName: string; updated: number }> {
  const id = diagnosticId();
  const { data } = await callable({ action: "rename", companyId, companyName, diagnosticId: id });
  if (!data || !isRenameAcknowledged(data, companyName.replace(/\s+/g, " ").trim()))
    throw Object.assign(new Error("O servidor não confirmou."), { code: "functions/internal", details: { reasonCode: "GROUP_ACK_INVALID", diagnosticId: id } });
  return { companyName: data.companyName, updated: Number(data.updated) || 0 };
}
