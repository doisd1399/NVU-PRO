import { useEffect, useState } from "react";
import { pendingOperationTripCount, OPERATION_OUTBOX_CHANGED } from "../services/operationOutbox";

/** Pending receipts enable a local finish request, never confirmed progress. */
export function useLocalOperationPending(uid?: string, companyId?: string, jobId?: string) {
  const [value, setValue] = useState({ key: "", count: 0 });
  const key = JSON.stringify([uid, companyId, jobId]);
  useEffect(() => {
    if (!uid || !companyId || !jobId) return;
    let alive = true, reading = false;
    const refresh = async () => {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const count = await pendingOperationTripCount(uid, companyId, jobId);
        if (alive) setValue(current => current.key === key && current.count === count ? current : { key, count });
      } catch { /* The durable stores keep their evidence until next refresh. */ }
      finally { reading = false; }
    };
    const events = ["nvu-canonical-trip-queued", "nvu-canonical-trip-updated", "nvu-offline-trip-queued", OPERATION_OUTBOX_CHANGED];
    void refresh();
    const timer = setInterval(refresh, 5000);
    for (const event of events) window.addEventListener(event, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); for (const event of events) window.removeEventListener(event, refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [key, uid, companyId, jobId]);
  return value.key === key ? value.count : 0;
}
