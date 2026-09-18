import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSessionStore } from "../context/AppContext";

type SessionStore = ReturnType<typeof useSessionStore>;

export type AuthSessionValue = Pick<
  SessionStore,
  | "currentUser"
  | "authInitialized"
  | "sessionUiReady"
  | "sessionReady"
  | "sessionRecovering"
  | "identityReconciliationStatus"
  | "sessionDiagnostic"
  | "refreshSession"
  | "logOutApp"
>;

const AuthSessionContext = createContext<AuthSessionValue | undefined>(
  undefined,
);

/**
 * Compatibility boundary for the new auth architecture. AppContext remains the
 * single owner of Firebase observers during migration; this provider exposes a
 * stable auth-only surface without creating another listener or Auth instance.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const session = useSessionStore();
  const value = useMemo<AuthSessionValue>(
    () => ({
      currentUser: session.currentUser,
      authInitialized: session.authInitialized,
      sessionUiReady: session.sessionUiReady,
      sessionReady: session.sessionReady,
      sessionRecovering: session.sessionRecovering,
      identityReconciliationStatus: session.identityReconciliationStatus,
      sessionDiagnostic: session.sessionDiagnostic,
      refreshSession: session.refreshSession,
      logOutApp: session.logOutApp,
    }),
    [
      session.authInitialized,
      session.currentUser,
      session.identityReconciliationStatus,
      session.logOutApp,
      session.refreshSession,
      session.sessionDiagnostic,
      session.sessionReady,
      session.sessionRecovering,
      session.sessionUiReady,
    ],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return context;
}
