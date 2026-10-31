import { inferNotificationTargetProfile } from "./notificationScope";
/**
 * Where a manager lands from a notification. A one-tap join request (the old flow) is answered in the Motoristas tab; a
 * driver's application is answered in Recursos Humanos; work requests and completed operations are in the operations tab.
 */
export function corporateNotificationTab(record: Record<string, any>): "hr" | "drivers" | "operations" | undefined {
  const type = record.type || record.tipo;
  if (type === "RH_APPLICATION") return "hr";
  if (type === "WORK_REQUEST" && String(record.dedupeKey || "").startsWith("JOIN_COMPANY_")) return "drivers";
  if (type === "WORK_REQUEST" || type === "OPERATION_COMPLETED") return "operations";
  return undefined;
}

export function notificationDestination(record: Record<string, any>, userId: string) {
  if (!userId || !record || record.userId !== userId) return null;
  const role = inferNotificationTargetProfile(record) === "corporate" ? "admin" : "driver";
  const type = record.type || record.tipo;
  const path = role === "admin" ? "/admin/fleet" : type === "NEW_OPERATION" ? "/driver" : "/driver/profile";
  const activeTab = corporateNotificationTab(record);
  return { role, companyId: typeof record.companyId === "string" ? record.companyId : "", path, activeTab } as const;
}
