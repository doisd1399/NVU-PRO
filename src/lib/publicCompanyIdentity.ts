// Mirrors the server allowlist. Public caches must never retain private fleet fields.
import { normalizeCompanyDescription } from "./companyProfileDescription";
const FIELDS = ["id", "companyName", "fleetName", "name", "nome", "logoUrl", "logoURL", "logo", "companyLogoURL",
  "profileCoverURL", "profileCoverRevision", "profileCoverUpdatedAt", "profileDescription", "profileDescriptionRevision", "profileDescriptionUpdatedAt", "simulatorId", "simuladorId", "simulatorName",
  "simuladorNome", "simulator", "simulador", "simulatorCode", "simulatorKey", "simuladorKey", "simuladorCodigo", "gameCode", "packageId", "status", "situacao", "state", "deleted", "isDeleted",
  "softDeleted", "excluida", "excluido", "isActive", "active", "isVerified", "verified", "createdAt", "approvedAt",
  "rankingEligible", "eligibleForRanking", "rankingEnabled", "excludeFromRanking", "currency", "moeda"];
export function publicCompanyIdentity(company: Record<string, any>): Record<string, any> {
  const projected = Object.fromEntries(FIELDS.filter(key => company[key] !== undefined).map(key => [key, company[key]]));
  if (company.profileDescription !== undefined) projected.profileDescription = normalizeCompanyDescription(company.profileDescription);
  if (typeof projected.profileDescriptionRevision !== "string") delete projected.profileDescriptionRevision;
  const settings = company.recruitmentSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const publicSettings = Object.fromEntries(["about", "rules", "howItWorks", "benefits", "isActive"].filter(key => typeof settings[key] === (key === "isActive" ? "boolean" : "string")).map(key => [key, settings[key]]));
    if (Object.keys(publicSettings).length) projected.recruitmentSettings = publicSettings;
  }
  return projected;
}
