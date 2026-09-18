import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useOperationalStore } from "../context/AppContext";

type OperationalStore = ReturnType<typeof useOperationalStore>;

export type OperationalDataValue = Pick<
  OperationalStore,
  | "users"
  | "jobs"
  | "contracts"
  | "vehicles"
  | "trailers"
  | "sequences"
  | "simulators"
  | "simulatorsLoading"
  | "simulatorsError"
  | "operationalDataReady"
  | "operationalDataRefreshing"
  | "jobsReady"
  | "contractsReady"
  | "usersReady"
  | "syncCompanyData"
>;

const OperationalDataContext = createContext<
  OperationalDataValue | undefined
>(undefined);

/**
 * Operational data boundary. This provider only projects the existing store;
 * realtime ownership and teardown remain centralized in AppContext during the
 * incremental migration, while routes are free to mount the shell first.
 */
export function OperationalDataProvider({
  children,
}: {
  children: ReactNode;
}) {
  const operational = useOperationalStore();
  const value = useMemo<OperationalDataValue>(
    () => ({
      users: operational.users,
      jobs: operational.jobs,
      contracts: operational.contracts,
      vehicles: operational.vehicles,
      trailers: operational.trailers,
      sequences: operational.sequences,
      simulators: operational.simulators,
      simulatorsLoading: operational.simulatorsLoading,
      simulatorsError: operational.simulatorsError,
      operationalDataReady: operational.operationalDataReady,
      operationalDataRefreshing: operational.operationalDataRefreshing,
      jobsReady: operational.jobsReady,
      contractsReady: operational.contractsReady,
      usersReady: operational.usersReady,
      syncCompanyData: operational.syncCompanyData,
    }),
    [
      operational.contracts,
      operational.jobs,
      operational.users,
      operational.operationalDataReady,
      operational.operationalDataRefreshing,
      operational.jobsReady,
      operational.contractsReady,
      operational.usersReady,
      operational.sequences,
      operational.simulators,
      operational.simulatorsError,
      operational.simulatorsLoading,
      operational.syncCompanyData,
      operational.trailers,
      operational.vehicles,
    ],
  );

  return (
    <OperationalDataContext.Provider value={value}>
      {children}
    </OperationalDataContext.Provider>
  );
}

export function useOperationalData() {
  const context = useContext(OperationalDataContext);
  if (!context) {
    throw new Error(
      "useOperationalData must be used within OperationalDataProvider",
    );
  }
  return context;
}
