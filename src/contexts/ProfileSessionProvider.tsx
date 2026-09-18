import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSessionStore } from "../context/AppContext";

const ProfileSessionContext = createContext<
  | {
      activeRole: ReturnType<typeof useSessionStore>["activeRole"];
      activeCompanyId: ReturnType<typeof useSessionStore>["activeCompanyId"];
      sessionReady: ReturnType<typeof useSessionStore>["sessionReady"];
      sessionUiReady: ReturnType<typeof useSessionStore>["sessionUiReady"];
      activeProfileContext: ReturnType<typeof useSessionStore>["activeProfileContext"];
      switchRole: ReturnType<typeof useSessionStore>["switchRole"];
      setActiveCompanyId: ReturnType<
        typeof useSessionStore
      >["setActiveCompanyId"];
    }
  | undefined
>(undefined);

/**
 * Profile selection boundary. It owns no authentication side effects yet; the
 * session facade remains the compatibility authority until consumers migrate.
 */
export function ProfileSessionProvider({ children }: { children: ReactNode }) {
  const session = useSessionStore();
  const value = useMemo(
    () => ({
      activeRole: session.activeRole,
      activeCompanyId: session.activeCompanyId,
      activeProfileContext: session.activeProfileContext,
      sessionReady: session.sessionReady,
      sessionUiReady: session.sessionUiReady,
      switchRole: session.switchRole,
      setActiveCompanyId: session.setActiveCompanyId,
    }),
    [
      session.activeCompanyId,
      session.activeRole,
      session.activeProfileContext,
      session.sessionReady,
      session.sessionUiReady,
      session.setActiveCompanyId,
      session.switchRole,
    ],
  );

  return (
    <ProfileSessionContext.Provider value={value}>
      {children}
    </ProfileSessionContext.Provider>
  );
}

export function useProfileSession() {
  const context = useContext(ProfileSessionContext);
  if (!context) {
    throw new Error(
      "useProfileSession must be used within ProfileSessionProvider",
    );
  }
  return context;
}
