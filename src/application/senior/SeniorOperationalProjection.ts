export type SeniorOperationalProjection = {
  companyId: string;
  totalDrivers: number;
  completedTrips: number;
  totalEarnings: number;
  lastActivity?: string;
};

export function buildSeniorOperationalProjection(input: {
  companyId: string;
  drivers?: number;
  trips?: number;
  earnings?: number;
  lastActivity?: string;
}): SeniorOperationalProjection {
  return {
    companyId: input.companyId,
    totalDrivers: input.drivers ?? 0,
    completedTrips: input.trips ?? 0,
    totalEarnings: input.earnings ?? 0,
    lastActivity: input.lastActivity,
  };
}
