import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import type { ManagementCacheScope } from "../lib/managementOfflineCache";

type GoalResponse = { companyId: string; simulatorId: string; periodKey: string; targetAmount: number; exists: boolean };
const access = httpsCallable<Record<string, unknown>, GoalResponse>(functions, "manageOperationalGoal", { timeout: 30_000 });
export async function accessManagedGoal(scope: ManagementCacheScope, documentId: string, amount?: number): Promise<GoalResponse> {
  const { data } = await access({ action: amount === undefined ? "read" : "save", companyId: scope.companyId, simulatorId: scope.simulatorId, documentId, ...(amount === undefined ? {} : { targetAmount: amount }) });
  if (data.companyId !== scope.companyId || data.simulatorId !== scope.simulatorId || !Number.isFinite(data.targetAmount) || data.targetAmount < 0 || typeof data.periodKey !== "string" || typeof data.exists !== "boolean") throw new Error("GOAL_RESPONSE_SCOPE_MISMATCH");
  return data;
}
