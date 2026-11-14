import React, { useMemo } from "react";
import { X } from "lucide-react";
import TripHistory from "../../../pages/driver/TripHistory";
import { HistoryMoneySummary } from "../../common/HistoryMoneySummary";
import { summarizeTripMoney } from "../../../lib/tripMoneySummary";
import { ManagementDialog } from "./ManagementDialog";
import type { ManagementOperation } from "./ManagementOperationCard";
import "./OperationInfoSheet.css";

/**
 * "Viagens da operação": the trips linked to one job. Fixed header (count and totals), independent scroll below.
 * `trips` is the canonical projection of that job (selectCanonicalOperationTrips: job identity + driver + company +
 * contract), already sorted from the newest to the oldest; the list itself is the history surface used elsewhere, so
 * view, edit, delete and expand keep their permissions.
 */
export function OperationTripsSheet({ operation, job, trips, companyTrips, loading, error, onClose }: {
  operation: ManagementOperation;
  job: Record<string, any>;
  trips: Record<string, any>[];
  companyTrips: Record<string, any>[];
  loading: boolean;
  error?: unknown;
  onClose: () => void;
}) {
  const groups = useMemo(() => summarizeTripMoney(trips), [trips]);
  return <ManagementDialog title="Viagens da operação" variant="sheet" onClose={onClose}>
    <div className="nvu-op-trips" data-testid="operation-trips-sheet">
      <div className="nvu-op-trips-summary">
        <div><small>{operation.name} · {operation.driverName}</small><strong data-testid="operation-trips-count">{trips.length} {trips.length === 1 ? "viagem" : "viagens"}</strong></div>
        {trips.length > 0 && <div className="nvu-op-trips-money"><HistoryMoneySummary groups={groups} totalEligibleTrips={trips.length} /></div>}
      </div>
      <div className="nvu-op-trips-list">
        <TripHistory embeddedJob={job} hideHeader hideHeaderActions hideFloatingSummary
          historicoTripsOverride={companyTrips as any} canonicalOperationTripsOverride={trips}
          historyLoadingOverride={loading} historyErrorOverride={error} />
      </div>
    </div>
  </ManagementDialog>;
}
