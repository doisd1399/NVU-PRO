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

/**
 * Paints the transition veil before replacing the complete role layout.
 *
 * Waiting for two animation frames is intentional: the first lets React commit
 * the persistent veil and the second guarantees that the browser/WebView has
 * painted it before the old profile tree is unmounted.
 */
export function commitRoleVisualTransition(
  targetRole: RoleTransitionTarget,
  update: () => void,
): void {
  // Role changes are a direct navigation acknowledgement. The previous
  // two-frame veil (with an 80 ms fallback) made taps appear ignored in
  // WebViews and compounded with the overlay's 180 ms fade. Commit the
  // destination in the current interaction frame; the destination layout
  // remains responsible for its own data feedback.
  void targetRole;
  update();
}

export function finishRoleVisualTransition(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ROLE_VISUAL_TRANSITION_END));
}
