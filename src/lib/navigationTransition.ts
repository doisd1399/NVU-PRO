/**
 * Applies route/profile state in the current interaction.
 *
 * Route and selector changes are the visible acknowledgement of the user's
 * click, so they must stay urgent. Marking them as a React transition allowed
 * the old screen/selection to remain visible while other updates were pending,
 * which made taps look ignored on Android and in the AI Studio preview.
 */
export function commitNavigation(update: () => void): void {
  update();
}

/**
 * Starts the destination warm-up and commits navigation immediately.
 *
 * The previous implementation awaited `prepare()` and then forced a synchronous
 * full render. On mobile/WebView that turned a normal click into a network wait
 * followed by a blocking render, and the global progress bar exposed the delay.
 * Preloading is now strictly best-effort and can never gate the route change.
 */
export function prepareAndCommitNavigation(
  prepare: () => Promise<unknown> | unknown,
  update: () => void,
): Promise<void> {
  // Commit first. Even invoking a dynamic import before this line can perform
  // enough synchronous module/runtime work to keep the previous screen visible
  // for a frame on slower Android WebViews.
  commitNavigation(update);

  let preparation: Promise<unknown> | null = null;
  try {
    // Warm-up remains best-effort and starts immediately after the route
    // change; Suspense owns the destination while the chunk finishes.
    preparation = Promise.resolve(prepare());
  } catch {
    // A preload failure must never stop navigation.
  }

  if (!preparation) return Promise.resolve();
  return preparation.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Variant for destinations that must be visually complete before the route is
 * revealed. Ranking uses this only for its first entry: the current screen
 * remains in place while its already-started photo/data barrier settles, so
 * the user never sees an initials -> photo transition in the destination.
 */
export async function prepareAndCommitNavigationWhenReady(
  prepare: () => Promise<unknown> | unknown,
  update: () => void,
): Promise<void> {
  // The click acknowledgement must happen in the same interaction frame.
  // Preparation is allowed to continue in parallel, but it must never make a
  // selector/button feel unresponsive while waiting for assets or data.
  commitNavigation(update);

  try {
    await Promise.resolve(prepare());
  } catch {
    // A failed warm-up must not make the app unusable. The destination still
    // owns its normal error/fallback rendering.
  }
}

export function isPlainPrimaryNavigation(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
