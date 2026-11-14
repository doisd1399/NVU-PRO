import { startTransition } from "react";

export type RoleTransitionTarget = "admin" | "driver";

export interface RoleVisualTransitionDetail {
  targetRole: RoleTransitionTarget;
}

export const ROLE_VISUAL_TRANSITION_START =
  "nvu-role-visual-transition-start";
export const ROLE_VISUAL_TRANSITION_END = "nvu-role-visual-transition-end";

export function beginRoleVisualTransition(
  targetRole: RoleTransitionTarget,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<RoleVisualTransitionDetail>(
      ROLE_VISUAL_TRANSITION_START,
      { detail: { targetRole } },
    ),
  );
}

/** Commit the authorized destination in the current interaction frame. */
export function commitRoleVisualTransition(
  targetRole: RoleTransitionTarget,
  update: () => void,
): void {
  // Keep the already visible workspace while the destination's lazy shell
  // suspends. The role and route belong to the same transition, so an urgent
  // role update cannot tear down the source before the new shell is ready.
  void targetRole;
  startTransition(update);
}

export function finishRoleVisualTransition(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ROLE_VISUAL_TRANSITION_END));
}

