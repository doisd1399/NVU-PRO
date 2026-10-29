import React, { useMemo } from "react";
import { ProfileRankingPerformanceCard } from "./ProfileRankingPerformanceCard";
import { filterTripsBySimulator, getFilteredTrips } from "../lib/metricsEngine";
import { normalizeTrip } from "../lib/tripNormalizer";
import { summarizeTripMoney } from "../lib/tripMoneySummary";
import type { CompanyProfilePresentation } from "./driver/DriverProfileSummary";

export interface CompanyPerformanceCardProps {
  historicoTrips: any[];
  globalHistoricoTrips?: any[];
  companyId: string;
  allCompanies: any[];
  simulatorId?: string;
  simulators?: Record<string, unknown>[];
  companiesLoading?: boolean;
  companyTripsLoading?: boolean;
  profilePresentation?: CompanyProfilePresentation;
}

export const CompanyPerformanceCard = React.memo(
  function CompanyPerformanceCard({
    historicoTrips,
    companyId,
    allCompanies,
    simulatorId,
    simulators = [],
    companyTripsLoading = false,
    profilePresentation,
  }: CompanyPerformanceCardProps) {
    const allTimeCompanyTrips = useMemo(
      () => getFilteredTrips(
        historicoTrips.map(normalizeTrip),
        undefined,
        undefined,
        companyId,
        undefined,
        allCompanies,
        undefined,
        simulators,
      ),
      [allCompanies, companyId, historicoTrips, simulators],
    );
    const ownTrips = useMemo(
      () =>
        filterTripsBySimulator(
          allTimeCompanyTrips,
          simulatorId,
          allCompanies,
          simulators,
        ),
      [allCompanies, allTimeCompanyTrips, simulatorId, simulators],
    );
    const careerMoneyGroups = summarizeTripMoney(allTimeCompanyTrips);
    const comparableCareerValue = careerMoneyGroups.length === 1 &&
      careerMoneyGroups[0].currencyStatus === "known" &&
      careerMoneyGroups[0].value !== null &&
      careerMoneyGroups[0].missingValueTrips === 0
      ? careerMoneyGroups[0].value
      : 0;
    // Preserve the existing career formula only when every amount is in one
    // known currency; mixed/unknown trips contribute no monetary component.
    const xp = Math.floor(
      allTimeCompanyTrips.length * 10 + comparableCareerValue * 0.1,
    );
    return (
      <ProfileRankingPerformanceCard
        participantId={companyId}
        companyId={companyId}
        companyProfile
        profilePresentation={profilePresentation}
        simulatorId={simulatorId}
        companies={allCompanies}
        simulators={simulators}
        ownTrips={ownTrips}
        ownTripsLoading={companyTripsLoading}
        career={{
          level: Math.floor(xp / 1000) + 1,
          xp,
          progress: (xp % 1000) / 10,
        }}
      />
    );
  },
);
