import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

export interface RepairApprovedMembershipResult {
  success: boolean;
  userId: string;
  companyId: string;
  applicationId: string;
}

export async function repairApprovedMembership(
  applicationId: string,
): Promise<RepairApprovedMembershipResult> {
  const normalizedApplicationId = applicationId.trim();
  if (!normalizedApplicationId) {
    throw new Error("applicationId é obrigatório para reparar o acesso.");
  }
  const callable = httpsCallable<{ applicationId: string }, RepairApprovedMembershipResult>(
    functions,
    "repairApprovedMembership",
  );
  const result = await callable({ applicationId: normalizedApplicationId });
  return result.data;
}
