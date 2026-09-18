
import React, { createContext, useContext, useMemo, useState } from "react";

export type RankingScope = "internal" | "global";

export interface PerformanceContextValue {
  rankingScope: RankingScope;
  setRankingScope: (scope: RankingScope) => void;
  period: {
    startDate?: Date;
    endDate?: Date;
  };
  setPeriod: (period: { startDate?: Date; endDate?: Date }) => void;
}

const PerformanceContext = createContext<PerformanceContextValue | null>(null);

export function PerformanceProvider({ children }: { children: React.ReactNode }) {
  const [rankingScope, setRankingScope] = useState<RankingScope>("global");
  const [period, setPeriod] = useState<{startDate?: Date; endDate?: Date}>({});

  const value = useMemo(() => ({
    rankingScope,
    setRankingScope,
    period,
    setPeriod,
  }), [rankingScope, period]);

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  );
}

export function usePerformanceContext() {
  const context = useContext(PerformanceContext);
  if (!context) throw new Error("usePerformanceContext must be used inside PerformanceProvider");
  return context;
}
