/**
 * Kept as a compatibility shim for older imports.
 *
 * Route changes are no longer represented by a loading bar because navigation
 * is committed in the click frame. Real data operations keep their local,
 * action-specific feedback inside the destination page.
 */
export function NavigationProgress() {
  return null;
}
