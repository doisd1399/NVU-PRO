import { inferNotificationTargetProfile } from "./notificationScope";
export function notificationDestination(record: Record<string, any>, userId: string) {
  if (!userId || !record || record.userId !== userId) return null;
  const role = inferNotificationTargetProfile(record) === "corporate" ? "admin" : "driver";
  const type = record.type || record.tipo;
  const path = role === "admin" ? "/admin/fleet" : type === "NEW_OPERATION" ? "/driver" : "/driver/profile";
  const activeTab = type === "RH_APPLICATION" ? "hr" : type === "WORK_REQUEST" ? "operations" : undefined;
  return { role, companyId: typeof record.companyId === "string" ? record.companyId : "", path, activeTab } as const;
}
