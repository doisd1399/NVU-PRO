/** One account per company, even when legacy memberships were duplicated. */
export function uniqueCompanyMembers(members: any[], companyId: string, ownerId?: string): any[] {
  const byUser = new Map<string, any>();
  for (const member of members) {
    if (member.companyId !== companyId || !member.userId || member.userId === ownerId || member.status === "removed") continue;
    const previous = byUser.get(member.userId);
    if (!previous || (member.status === "active" && previous.status !== "active")) byUser.set(member.userId, member);
  }
  return [...byUser.values()];
}
