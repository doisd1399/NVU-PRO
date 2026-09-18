import { isInteractionFirstRoute } from "../lib/foregroundRoute";

export type OperationalRealtimePolicy = {
  enabled: boolean;
  reason: "signed-out" | "interaction-first" | "workspace";
};

type OperationalRealtimePolicyInput = {
  currentUserId: string | null;
  foregroundPathname: string;
};

/**
 * Decides whether company-scoped operational listeners may be attached.
 * Authentication/session ownership remains in AppContext; this module only
 * owns the route-level scheduling decision.
 */
export function resolveOperationalRealtimePolicy({
  currentUserId,
  foregroundPathname,
}: OperationalRealtimePolicyInput): OperationalRealtimePolicy {
  if (!currentUserId) {
    return { enabled: false, reason: "signed-out" };
  }
  if (isInteractionFirstRoute(foregroundPathname)) {
    return { enabled: false, reason: "interaction-first" };
  }
  return { enabled: true, reason: "workspace" };
}
