export type AuthSessionProjection = {
  sessionUiReady: boolean;
  sessionAuthorized: boolean;
};

type AuthSessionProjectionInput = {
  authInitialized: boolean;
  firebaseSessionUid: string | null;
  currentUserId: string | null;
  /** Local UID-scoped snapshot may paint the UI before Firebase settles. */
  visualIdentityReady?: boolean;
  sessionRecovering: boolean;
  membershipsLoaded: boolean;
};

/**
 * Visual readiness may come from a UID-scoped local snapshot so the selector
 * can paint before Firebase settles. Protected authorization still requires a
 * coherent Firebase identity plus the current membership result. Recovery may
 * continue in the background after a previously confirmed snapshot.
 */
export function projectAuthSession({
  authInitialized,
  firebaseSessionUid,
  currentUserId,
  visualIdentityReady = false,
  sessionRecovering: _sessionRecovering,
  membershipsLoaded,
}: AuthSessionProjectionInput): AuthSessionProjection {
  const hasVisualIdentity = Boolean(visualIdentityReady && currentUserId);
  const hasCoherentIdentity = Boolean(
    authInitialized &&
      firebaseSessionUid &&
      currentUserId === firebaseSessionUid,
  );

  return {
    sessionUiReady: hasVisualIdentity || hasCoherentIdentity,
    sessionAuthorized:
      hasCoherentIdentity && membershipsLoaded,
  };
}
