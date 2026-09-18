import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";

type SessionStore = ReturnType<typeof useSessionStore>;
type CompanyStore = ReturnType<typeof useCompanyStore>;

export type MembershipSessionValue = Pick<
  SessionStore,
  | "memberships"
  | "membershipsLoaded"
  | "membershipsUiReady"
  | "sessionReady"
  | "sessionUiReady"
> &
  Pick<
    CompanyStore,
    | "activeCompanyId"
    | "allCompanyMembers"
    | "allCompanies"
    | "companies"
    | "companiesLoading"
  >;

const MembershipContext = createContext<
  MembershipSessionValue | undefined
>(undefined);

/**
 * Membership compatibility boundary. It projects the existing single owner;
 * authorization is still decided by AppContext/ProtectedRoute and never by a
 * second Firestore query in this provider.
 */
export function MembershipProvider({ children }: { children: ReactNode }) {
  const session = useSessionStore();
  const companies = useCompanyStore();
  const value = useMemo<MembershipSessionValue>(
    () => ({
      memberships: session.memberships,
      membershipsLoaded: session.membershipsLoaded,
      membershipsUiReady: session.membershipsUiReady,
      sessionReady: session.sessionReady,
      activeCompanyId: companies.activeCompanyId,
      allCompanies: companies.allCompanies,
      sessionUiReady: session.sessionUiReady,
      allCompanyMembers: companies.allCompanyMembers,
      companies: companies.companies,
      companiesLoading: companies.companiesLoading,
    }),
    [
      companies.activeCompanyId,
      companies.allCompanyMembers,
      companies.allCompanies,
      companies.companies,
      companies.companiesLoading,
      session.memberships,
      session.membershipsLoaded,
      session.membershipsUiReady,
      session.sessionReady,
      session.sessionUiReady,
    ],
  );

  return (
    <MembershipContext.Provider value={value}>
      {children}
    </MembershipContext.Provider>
  );
}

export function useMembershipSession() {
  const context = useContext(MembershipContext);
  if (!context) {
    throw new Error(
      "useMembershipSession must be used within MembershipProvider",
    );
  }
  return context;
}
