/** Production keeps HTTPS. The explicitly isolated Firebase demo may use its
 * real loopback Storage emulator URL, which the server already supports. */
export function hasConfirmedReceiptTransport(value: string, emulatorProjectId?: string): boolean {
  if (/^https:\/\//i.test(value)) return true;
  if (emulatorProjectId !== "demo-nvu-v36-4-staging") return false;
  try {
    const url = new URL(value);
    if (url.origin !== "http://127.0.0.1:9199" || url.username || url.password) return false;
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    return Boolean(match && [emulatorProjectId + ".appspot.com", emulatorProjectId + ".firebasestorage.app"].includes(decodeURIComponent(match[1])));
  } catch { return false; }
}

export function isConfirmedReceiptUploadUrl(value: string): boolean {
  const env = (import.meta.env || {}) as Record<string, unknown>;
  const isolatedDemo = env.VITE_USE_FIREBASE_EMULATORS === "true" &&
    env.VITE_FIREBASE_PROJECT_ID === "demo-nvu-v36-4-staging";
  return hasConfirmedReceiptTransport(value, isolatedDemo ? "demo-nvu-v36-4-staging" : undefined);
}
