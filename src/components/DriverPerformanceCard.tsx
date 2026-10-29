import React, { useMemo } from "react";
import { ProfileRankingPerformanceCard } from "./ProfileRankingPerformanceCard";
import { filterTripsBySimulator } from "../lib/metricsEngine";
import { normalizeTrip } from "../lib/tripNormalizer";
import { getCanonicalTripDriverId } from "../lib/tripIdentity";
import type { DriverProfilePresentation } from "./driver/DriverProfileSummary";

export interface DriverPerformanceCardProps {
  historicoTrips: any[];
  globalHistoricoTrips?: any[];
  globalTripsLoading?: boolean;
  driverTripsLoading?: boolean;
  driverId: string;
  activeCompanyId: string | null;
  allCompanyMembers: any[];
  users?: any[];
  currentUser: any;
  simulatorId?: string;
  allCompanies?: any[];
  simulators?: Record<string, unknown>[];
  displayLevel?: number;
  currentLevelXp?: number;
  xpProgress?: number;
  rankingScope?: "internal" | "global";
  hideScopeSelector?: boolean;
  profilePresentation?: DriverProfilePresentation;
}

export const DriverPerformanceCard = React.memo(function DriverPerformanceCard({
  historicoTrips,
  driverTripsLoading = false,
  driverId,
  activeCompanyId,
  allCompanyMembers,
  users = [],
  currentUser,
  simulatorId,
  allCompanies = [],
  simulators = [],
  displayLevel = 1,
  currentLevelXp = 0,
  xpProgress = 0,
  rankingScope,
  hideScopeSelector,
  profilePresentation,
}: DriverPerformanceCardProps) {
  // Own history paints the activity calendar; it is never a global population.
  const ownTrips = useMemo(
    () =>
      filterTripsBySimulator(
        historicoTrips.map(normalizeTrip).filter((trip) => trip.isValid),
        simulatorId,
        allCompanies,
        simulators,
      ).filter((trip) => getCanonicalTripDriverId(trip) === driverId),
    [allCompanies, driverId, historicoTrips, simulatorId, simulators],
  );
  const profileUsers = useMemo(() => {
    const byId = new Map(
      users.filter((user) => user?.id).map((user) => [String(user.id), user]),
    );
    if (currentUser?.id) byId.set(String(currentUser.id), currentUser);
    return Array.from(byId.values());
  }, [currentUser, users]);
  return (
    <ProfileRankingPerformanceCard
      participantId={driverId}
      companyId={activeCompanyId}
      simulatorId={simulatorId}
      companies={allCompanies}
      simulators={simulators}
      users={profileUsers}
      companyMembers={allCompanyMembers}
      ownTrips={ownTrips}
      ownTripsLoading={driverTripsLoading}
      career={{ level: displayLevel, xp: currentLevelXp, progress: xpProgress }}
      rankingScope={rankingScope}
      hideScopeSelector={hideScopeSelector}
      profilePresentation={profilePresentation}
    />
  );
});
