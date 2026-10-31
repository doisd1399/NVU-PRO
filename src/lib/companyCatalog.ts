/** Pure rules of the public company catalog shown to drivers (screen "Empresas"). */
type CompanyLike = Record<string, any>;

const NOT_LISTED_STATUS = new Set(["deleted", "archived", "disabled", "blocked", "pending", "rejected", "suspended", "inactive"]);

/** A company that is deleted, archived, suspended, not yet approved or inactive is never offered to candidates. */
export function isCompanyListable(company: CompanyLike | null | undefined): boolean {
  if (!company) return false;
  if (company.deleted === true || company.isDeleted === true || company.softDeleted === true) return false;
  if (company.active === false || company.isActive === false) return false;
  return !NOT_LISTED_STATUS.has(String(company.status || "active").trim().toLowerCase());
}

/** Same default as the public application page: recruiting is open unless the company switched it off. */
export function isRecruitmentOpen(company: CompanyLike | null | undefined): boolean {
  return company?.recruitmentSettings?.isActive !== false;
}

export type CompanyApplyState = "member" | "applied" | "closed" | "open";

/** What the card of a company offers to this driver. A link and a pending application win over the open/closed flag. */
export function companyApplyState(company: CompanyLike, memberCompanyIds: ReadonlySet<string>, appliedCompanyIds: ReadonlySet<string>): CompanyApplyState {
  if (memberCompanyIds.has(company.id)) return "member";
  if (appliedCompanyIds.has(company.id)) return "applied";
  return isRecruitmentOpen(company) ? "open" : "closed";
}

/** Dates of applications arrive as Firestore Timestamps, ISO strings, epoch numbers or {seconds}. Returns null when unreadable. */
export function toApplicationDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "string" || typeof value === "number") date = new Date(value);
  else if (typeof value === "object") {
    const row = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof row.toDate === "function") { try { date = row.toDate(); } catch { date = null; } }
    else if (typeof row.seconds === "number") date = new Date(row.seconds * 1000);
    else if (typeof row._seconds === "number") date = new Date(row._seconds * 1000);
  }
  return date && Number.isFinite(date.getTime()) ? date : null;
}
