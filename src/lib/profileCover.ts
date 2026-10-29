export type ProfileCoverScope = "driver" | "company";
export type ProfileCoverTarget = { scope: ProfileCoverScope; profileId: string };
export type ProfileCoverMetadata = { url: string; revision: string };

/** Personal identity, deliberately independent of any vehicle or simulator. */
export function resolveProfileCover(value: unknown): ProfileCoverMetadata {
  const profile = (value || {}) as Record<string, unknown>;
  const url = typeof profile.profileCoverURL === "string" ? profile.profileCoverURL.trim() : "";
  return { url: /^https:\/\//.test(url) ? url : "", revision: String(profile.profileCoverRevision || "") };
}

export function isProfileCoverPage(pathname: string, state?: unknown): boolean {
  const navigation = (state || {}) as Record<string, unknown>;
  if (["/admin/history", "/admin/reports", "/driver/history", "/driver/reports"].includes(pathname)) return true;
  if (pathname === "/driver/profile") return ["activity", "operations", "results", "profile"].includes(String(navigation.profileTab));
  return pathname === "/admin/fleet" && ["company", "history", "reports"].includes(String(navigation.activeTab));
}
