/**
 * "Inscrever-se" opens the company's recruitment form (the same one HR reviews). The screen that sent the driver there
 * passes where to come back to. Only the app's own driver/onboarding screens are accepted; anything else is ignored.
 */
const ALLOWED = [/^\/driver(\/[A-Za-z0-9_-]+)*$/, /^\/pending-applications$/, /^\/select-profile$/];

export function safeApplyReturnTo(state: unknown): string {
  const value = state && typeof state === "object" ? (state as { returnTo?: unknown }).returnTo : undefined;
  if (typeof value !== "string" || value.length > 120 || !value.startsWith("/") || value.startsWith("//")) return "";
  return ALLOWED.some(pattern => pattern.test(value)) ? value : "";
}

export function applyRoute(companyId: string, returnTo: string) {
  return { to: `/apply/${encodeURIComponent(companyId)}`, state: { returnTo } };
}
