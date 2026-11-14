export type ProfileCoverScope = "driver" | "company";
export type ProfileCoverTarget = { scope: ProfileCoverScope; profileId: string };
export type ProfileCoverMetadata = { url: string; revision: string };

/** Personal identity, deliberately independent of any vehicle or simulator. */
export function resolveProfileCover(value: unknown): ProfileCoverMetadata {
  const profile = (value || {}) as Record<string, unknown>;
  const url = typeof profile.profileCoverURL === "string" ? profile.profileCoverURL.trim() : "";
  return { url: /^https:\/\//.test(url) ? url : "", revision: String(profile.profileCoverRevision || "") };
}

/** Another driver's profile opened from the management app: it brings its own cover, like the company profile. */
export function isAdminDriverProfileViewPath(pathname: string): boolean {
  return /^\/admin\/driver\/[^/]+\/perfil\/?$/.test(pathname);
}

export function isProfileCoverPage(pathname: string, state?: unknown): boolean {
  const navigation = (state || {}) as Record<string, unknown>;
  if (["/admin/history", "/admin/reports", "/driver/history", "/driver/reports"].includes(pathname)) return true;
  if (isAdminDriverProfileViewPath(pathname)) return true;
  if (pathname === "/driver/profile") return ["activity", "operations", "results", "profile"].includes(String(navigation.profileTab));
  return pathname === "/admin/fleet" && ["company", "history", "reports"].includes(String(navigation.activeTab));
}

/** What the device keeps about a cover: the user's own unsent choice, or a cached copy of what the server had. */
export type ProfileCoverCacheView = { status: "pending" | "synced"; removed?: boolean; imageDataUrl: string; remoteUrl: string } | null;

/**
 * Which image to show. The user's own unsent choice (a new photo, or a removal) always wins. A synced cache row is only
 * trusted while it describes the current remote cover: a row cached when the server had no cover, or older bytes, must
 * never hide a newer remote URL, even if the new bytes cannot be downloaded (a browser without CORS on the bucket):
 * the remote URL itself is displayable by the img element.
 */
export function resolveProfileCoverSource(record: ProfileCoverCacheView, remoteUrl: string): string {
  if (!record) return remoteUrl;
  if (record.status === "pending") return record.removed ? "" : record.imageDataUrl || remoteUrl;
  if (remoteUrl && record.remoteUrl !== remoteUrl) return remoteUrl;
  return record.removed ? "" : record.imageDataUrl || remoteUrl;
}
