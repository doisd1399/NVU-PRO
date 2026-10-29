export const COMPANY_DESCRIPTION_LIMIT = 160;

/** Plain public copy, never markup or a vehicle identity. */
export function normalizeCompanyDescription(value: unknown): string {
  return typeof value === "string"
    ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, COMPANY_DESCRIPTION_LIMIT).join("").trim()
    : "";
}

export function canManageCompanyProfile(userId: string, company: Record<string, any> | null | undefined,
  memberships: readonly Record<string, any>[], seniorCompanyId?: string | null): boolean {
  if (!userId || !company?.id) return false;
  if (company.ownerId === userId || company.userId === userId || seniorCompanyId === company.id) return true;
  return memberships.some(member => member.companyId === company.id && member.userId === userId && member.status === "active" &&
    [...(Array.isArray(member.roles) ? member.roles : []), member.role].some(role => role === "admin" || role === "owner"));
}
