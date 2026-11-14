import { resolveMembershipRoles } from "./membershipRoles";
export function companyTeamRoles(userId: string, companyId: string, members: any[], company?: any): string[] {
  if (!userId || !companyId) return [];
  if (company?.id === companyId && (company.ownerId === userId || company.userId === userId)) return ["admin", "driver"];
  const links = members.filter(row => row.userId === userId && row.companyId === companyId);
  const active = links.find(row => row.status === "active");
  return active ? resolveMembershipRoles(active) : [];
}
