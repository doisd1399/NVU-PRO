import { useEffect, useMemo, useState } from "react";
import { syncEngine } from "../services/sync/SyncEngine";
import { pendingRegistrationHistoryRows } from "../lib/pendingHistoryTrips";
import { isDefinitelyOffline } from "../lib/connectivity";
import { onAuthTeardown, isAuthTeardownActive } from "../lib/authLifecycle";

export function useLocalTripHistory(companyId: string, jobId?: string, ownerId?: string,
  source: Pick<typeof syncEngine, "getOwnedHistoryRegistrations"> = syncEngine) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const events = ["nvu-canonical-trip-queued", "nvu-trip-sync-state-changed", "nvu-canonical-trip-updated", "nvu:canonical-trip-updated", "storage", "online", "offline"];
    events.forEach(event => window.addEventListener(event, refresh));
    const stop = onAuthTeardown(refresh);
    refresh();
    return () => { stop(); events.forEach(event => window.removeEventListener(event, refresh)); };
  }, [companyId, jobId, ownerId]);
  return useMemo(() => {
    void revision;
    if (!companyId || isAuthTeardownActive()) return [];
    try { return pendingRegistrationHistoryRows(source.getOwnedHistoryRegistrations(companyId, jobId), isDefinitelyOffline()); }
    catch { return []; } // A damaged journal is diagnosed separately; history remains readable.
  }, [companyId, jobId, ownerId, revision, source]);
}
